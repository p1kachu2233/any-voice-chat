const form = document.querySelector("#settingsForm");
const statusText = document.querySelector("#statusText");
const messages = document.querySelector("#messages");
const chatForm = document.querySelector("#chatForm");
const messageInput = document.querySelector("#messageInput");
const recordButton = document.querySelector("#recordButton");
const recordIcon = document.querySelector("#recordIcon");
const replyAudio = document.querySelector("#replyAudio");
const speechToggle = document.querySelector("#speechToggle");
const gsvStatus = document.querySelector("#gsvStatus");
const helpTooltip = document.createElement("div");
helpTooltip.className = "help-tooltip";
document.body.appendChild(helpTooltip);
const urlParams = new URLSearchParams(window.location.search);
const isSettingsOnly = urlParams.get("settings") === "1";
if (isSettingsOnly) {
  document.body.classList.add("settings-only");
}

let settings = {};
let history = [];
let recorder = null;
let chunks = [];
let busy = false;
let audioQueue = [];
let audioPlaying = false;
let currentObjectUrl = null;
let pinnedHelpAnchor = null;
let audioContext = null;
let streamPlaybackTime = 0;
const inlineAudioStreams = new Map();

const numericFields = new Set([
  "openai_temperature",
  "top_k",
  "top_p",
  "tts_temperature",
  "speed_factor",
  "streaming_mode",
  "tts_min_segment_chars",
]);
const checkboxFields = new Set(["enable_gsv_tts"]);
const defaultFormValues = {
  tts_min_segment_chars: 10,
  text_display_mode: "speech_sync",
};

function setStatus(text) {
  if (statusText) statusText.textContent = text;
  if (isSettingsOnly && window.parent !== window) {
    window.parent.postMessage({ type: "admin-status", text }, window.location.origin);
  }
}

function setGsvStatus(text, state = "neutral") {
  if (!gsvStatus) {
    setStatus(text);
    return;
  }
  gsvStatus.textContent = text;
  gsvStatus.dataset.state = state;
}

function setupHelpTips() {
  document.querySelectorAll(".help-icon").forEach((item) => {
    item.addEventListener("mouseenter", () => showHelpTooltip(item));
    item.addEventListener("focus", () => showHelpTooltip(item));
    item.addEventListener("mouseleave", () => {
      if (pinnedHelpAnchor !== item) hideHelpTooltip();
    });
    item.addEventListener("blur", () => {
      if (pinnedHelpAnchor !== item) hideHelpTooltip();
    });
    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (pinnedHelpAnchor === item) {
        pinnedHelpAnchor = null;
        hideHelpTooltip();
      } else {
        pinnedHelpAnchor = item;
        showHelpTooltip(item);
      }
    });
  });
}

function showHelpTooltip(anchor) {
  const text = anchor.dataset.tip || anchor.dataset.help || anchor.getAttribute("aria-label");
  if (!text) return;
  helpTooltip.textContent = text;
  helpTooltip.classList.add("visible");
  const rect = anchor.getBoundingClientRect();
  const tooltipRect = helpTooltip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - tooltipRect.width - 12, Math.max(12, rect.left));
  const top = Math.min(window.innerHeight - tooltipRect.height - 12, rect.bottom + 8);
  helpTooltip.style.left = `${left}px`;
  helpTooltip.style.top = `${top}px`;
}

function hideHelpTooltip() {
  helpTooltip.classList.remove("visible");
}

document.addEventListener("click", () => {
  pinnedHelpAnchor = null;
  hideHelpTooltip();
});

function showEmpty() {
  if (messages.children.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "开始一次语音或文字聊天";
    messages.appendChild(empty);
  }
}

function clearEmpty() {
  const empty = messages.querySelector(".empty");
  if (empty) empty.remove();
}

function appendMessage(role, content, audioUrl = null) {
  clearEmpty();
  const item = document.createElement("div");
  item.className = `message ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = content;
  item.appendChild(bubble);
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;

  if (audioUrl) {
    replyAudio.src = audioUrl;
    replyAudio.play().catch(() => {});
  }
}

function createStreamingMessage(role) {
  clearEmpty();
  const item = document.createElement("div");
  item.className = `message ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  item.appendChild(bubble);
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
  return bubble;
}

function createTypewriter(bubble, options = {}) {
  let visible = "";
  let pending = "";
  let timer = null;
  let waiting = false;
  const idleResolvers = [];
  const speechMode = options.speech === true;

  const render = () => {
    const suffix = waiting || pending || timer ? "..." : "";
    bubble.textContent = `${visible}${suffix}`;
    messages.scrollTop = messages.scrollHeight;
  };

  const resolveIdle = () => {
    while (idleResolvers.length > 0) {
      const resolve = idleResolvers.shift();
      resolve();
    }
  };

  const tick = () => {
    if (!pending) {
      timer = null;
      render();
      resolveIdle();
      return;
    }

    const nextChar = pending.slice(0, 1);
    visible += nextChar;
    pending = pending.slice(1);
    render();
    const punctuationPause = /[。！？!?；;，,、：:\n]/.test(nextChar);
    const delay = speechMode
      ? punctuationPause ? 260 : 110
      : punctuationPause ? 120 : 36;
    timer = window.setTimeout(tick, delay);
  };

  return {
    push(delta) {
      if (!delta) return;
      waiting = true;
      pending += delta;
      if (!timer) tick();
    },
    setWaiting(value) {
      waiting = value;
      if (!timer) render();
    },
    finish(finalText) {
      waiting = false;
      if (finalText && finalText.length > visible.length + pending.length) {
        pending += finalText.slice(visible.length + pending.length);
      }
      if (!pending && !timer) {
        render();
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        idleResolvers.push(resolve);
        if (!timer) tick();
      });
    },
  };
}

async function assertGsvReady() {
  const health = await requestJson("/api/health");
  const gsv = health.gsv.health || {};
  if (!gsv.ok) {
    const reason = gsv.error || gsv.message || gsv.status_code || "未知状态";
    throw new Error(`已启用 GSV 语音合成，但 GSV 未连接：${reason}`);
  }
}

function audioUrlFromEvent(event) {
  if (event.audio_url) return event.audio_url;
  if (!event.audio_base64) return null;
  const bytes = bytesFromBase64(event.audio_base64);
  const mediaType = event.media_type || "wav";
  const blob = new Blob([bytes], { type: `audio/${mediaType}` });
  return URL.createObjectURL(blob);
}

function bytesFromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function enqueueAudio(event) {
  const audioUrl = typeof event === "string" ? event : audioUrlFromEvent(event);
  if (!audioUrl) return;
  audioQueue.push(audioUrl);
  playNextAudio();
}

function markCompleteAfterInlineAudio() {
  if (!audioContext) return;
  const waitMs = Math.max(0, streamPlaybackTime - audioContext.currentTime) * 1000 + 120;
  window.setTimeout(() => {
    if (!busy && !audioPlaying && audioQueue.length === 0) {
      setStatus("完成");
    }
  }, waitMs);
}

async function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
  return audioContext;
}

function concatBytes(a, b) {
  if (!a || a.length === 0) return b;
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

function asciiAt(bytes, offset, text) {
  if (offset + text.length > bytes.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function parseWavHeader(bytes) {
  if (bytes.length < 44 || !asciiAt(bytes, 0, "RIFF") || !asciiAt(bytes, 8, "WAVE")) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  const info = { channels: 1, sampleRate: 32000, bitsPerSample: 16, dataOffset: 44 };
  while (offset + 8 <= bytes.length) {
    const chunkId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkData = offset + 8;
    if (chunkData + chunkSize > bytes.length && chunkId !== "data") return null;

    if (chunkId === "fmt ") {
      info.channels = view.getUint16(chunkData + 2, true);
      info.sampleRate = view.getUint32(chunkData + 4, true);
      info.bitsPerSample = view.getUint16(chunkData + 14, true);
    } else if (chunkId === "data") {
      info.dataOffset = chunkData;
      return info;
    }
    offset = chunkData + chunkSize + (chunkSize % 2);
  }
  return null;
}

function schedulePcmChunk(ctx, bytes, format) {
  const bytesPerSample = format.bitsPerSample / 8;
  const frameSize = bytesPerSample * format.channels;
  const frameCount = Math.floor(bytes.length / frameSize);
  if (frameCount <= 0 || bytesPerSample !== 2) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, frameCount * frameSize);
  const buffer = ctx.createBuffer(format.channels, frameCount, format.sampleRate);
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < format.channels; channel += 1) {
      const sampleOffset = frame * frameSize + channel * bytesPerSample;
      buffer.getChannelData(channel)[frame] = view.getInt16(sampleOffset, true) / 32768;
    }
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  const startTime = Math.max(streamPlaybackTime, ctx.currentTime + 0.05);
  streamPlaybackTime = startTime;
  source.start(startTime);
  streamPlaybackTime += buffer.duration;
  return { frames: frameCount, startTime };
}

function createInlineAudioStream(audioId, text = "", onPlaybackStart = null) {
  inlineAudioStreams.set(audioId, {
    pending: new Uint8Array(0),
    format: null,
    chunks: [],
    scheduledFrames: 0,
    receivedBytes: 0,
    text,
    onPlaybackStart,
    textRevealed: false,
  });
}

function revealInlineTextAtPlayback(ctx, state, startTime) {
  if (!state.text || !state.onPlaybackStart || state.textRevealed) return;
  state.textRevealed = true;
  const delayMs = Math.max(0, startTime - ctx.currentTime) * 1000;
  window.setTimeout(() => {
    state.onPlaybackStart(state.text);
  }, delayMs);
}

async function pushInlineAudioChunk(audioId, audioBase64) {
  const ctx = await ensureAudioContext();
  let state = inlineAudioStreams.get(audioId);
  if (!state) {
    state = {
      pending: new Uint8Array(0),
      format: null,
      chunks: [],
      scheduledFrames: 0,
      receivedBytes: 0,
      text: "",
      onPlaybackStart: null,
      textRevealed: false,
    };
    inlineAudioStreams.set(audioId, state);
  }

  const bytes = bytesFromBase64(audioBase64);
  state.chunks.push(bytes);
  state.receivedBytes += bytes.length;
  state.pending = concatBytes(state.pending, bytes);
  if (!state.format) {
    const parsed = parseWavHeader(state.pending);
    if (!parsed) {
      setStatus("收到语音数据，等待音频头");
      return;
    }
    state.format = parsed;
    state.pending = state.pending.slice(parsed.dataOffset);
    setStatus(`语音流已连接 ${parsed.sampleRate}Hz`);
  }

  const frames = drainInlineAudioState(ctx, state, false);
  if (frames > 0) setStatus("语音播放中");
}

async function finishInlineAudioStream(audioId) {
  const ctx = await ensureAudioContext();
  const state = inlineAudioStreams.get(audioId);
  if (state) {
    const frames = drainInlineAudioState(ctx, state, true);
    if (frames > 0) setStatus("语音播放中");
    if (state.scheduledFrames === 0) {
      if (state.receivedBytes > 0) {
        revealInlineTextAtPlayback(ctx, state, ctx.currentTime);
        const fallbackUrl = URL.createObjectURL(new Blob(state.chunks, { type: "audio/wav" }));
        enqueueAudio(fallbackUrl);
        setStatus("语音流解码失败，已切换普通播放");
      } else {
        setStatus("语音合成没有返回音频");
      }
    }
    inlineAudioStreams.delete(audioId);
  }
}

function drainInlineAudioState(ctx, state, final) {
  if (!state.format) return 0;
  const frameSize = (state.format.bitsPerSample / 8) * state.format.channels;
  const playableLength = final ? state.pending.length - (state.pending.length % frameSize) : state.pending.length - (state.pending.length % frameSize);
  let frames = 0;
  if (playableLength > 0) {
    const scheduled = schedulePcmChunk(ctx, state.pending.slice(0, playableLength), state.format);
    frames = scheduled?.frames || 0;
    if (scheduled && frames > 0) {
      revealInlineTextAtPlayback(ctx, state, scheduled.startTime);
    }
    state.scheduledFrames += frames;
    state.pending = state.pending.slice(playableLength);
  }
  return frames;
}

function waitForScheduledAudioEnd(extraMs = 120) {
  if (!audioContext) return Promise.resolve();
  const waitMs = Math.max(0, streamPlaybackTime - audioContext.currentTime) * 1000 + extraMs;
  return new Promise((resolve) => window.setTimeout(resolve, waitMs));
}

async function playWavStream(url) {
  const ctx = await ensureAudioContext();
  streamPlaybackTime = Math.max(streamPlaybackTime, ctx.currentTime + 0.05);

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(await response.text() || "语音流请求失败");
  }

  const reader = response.body.getReader();
  let pending = new Uint8Array(0);
  let format = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending = concatBytes(pending, value);

    if (!format) {
      const parsed = parseWavHeader(pending);
      if (!parsed) continue;
      format = parsed;
      pending = pending.slice(parsed.dataOffset);
    }

    const frameSize = (format.bitsPerSample / 8) * format.channels;
    const playableLength = pending.length - (pending.length % frameSize);
    if (playableLength > 0) {
      schedulePcmChunk(ctx, pending.slice(0, playableLength), format);
      pending = pending.slice(playableLength);
    }
  }

  if (format && pending.length > 0) {
    schedulePcmChunk(ctx, pending, format);
  }

  const waitMs = Math.max(0, streamPlaybackTime - ctx.currentTime) * 1000 + 80;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

function playElementAudio(audioUrl) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      replyAudio.removeEventListener("ended", onEnded);
      replyAudio.removeEventListener("error", onError);
    };
    const onEnded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("音频播放失败"));
    };
    replyAudio.addEventListener("ended", onEnded, { once: true });
    replyAudio.addEventListener("error", onError, { once: true });
    replyAudio.src = audioUrl;
    replyAudio.play().catch((error) => {
      cleanup();
      reject(error);
    });
  });
}

async function playNextAudio() {
  if (audioPlaying || audioQueue.length === 0) return;
  audioPlaying = true;
  const nextUrl = audioQueue.shift();
  currentObjectUrl = nextUrl.startsWith("blob:") ? nextUrl : null;
  try {
    if (nextUrl.includes("/api/tts/stream/")) {
      await playWavStream(nextUrl);
    } else {
      await playElementAudio(nextUrl);
    }
  } catch (error) {
    setStatus(`语音播放失败：${error.message}`);
  } finally {
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
    audioPlaying = false;
    if (!busy && audioQueue.length === 0) {
      setStatus("完成");
    }
    playNextAudio();
  }
}

function readForm() {
  const data = {};
  new FormData(form).forEach((value, key) => {
    data[key] = numericFields.has(key) ? Number(value) : value;
  });
  checkboxFields.forEach((key) => {
    const field = form.elements[key];
    if (key === "enable_gsv_tts" && speechToggle) {
      data[key] = speechToggle.checked;
    } else if (field) {
      data[key] = field.checked;
    } else if (Object.prototype.hasOwnProperty.call(settings, key)) {
      data[key] = settings[key];
    }
  });
  return data;
}

function fillForm(data) {
  for (const [key, value] of Object.entries({ ...defaultFormValues, ...data })) {
    const field = form.elements[key];
    if (!field) continue;
    if (checkboxFields.has(key)) {
      field.checked = value !== false && value !== "false";
    } else {
      field.value = value ?? "";
    }
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const detail = payload.detail || payload.message || payload;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
  }
  return payload;
}

function syncSpeechToggle() {
  if (speechToggle) {
    speechToggle.checked = settings.enable_gsv_tts !== false;
  }
}

async function loadSettings() {
  settings = await requestJson("/api/settings");
  fillForm(settings);
  syncSpeechToggle();
  showEmpty();
}

async function saveSettings(announce = true) {
  settings = await requestJson("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings: readForm() }),
  });
  fillForm(settings);
  syncSpeechToggle();
  if (announce) setStatus("设置已保存");
  return settings;
}

async function saveSpeechSetting(enabled) {
  const freshSettings = await requestJson("/api/settings");
  freshSettings.enable_gsv_tts = enabled;
  settings = await requestJson("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings: freshSettings }),
  });
  fillForm(settings);
  syncSpeechToggle();
  return settings;
}

async function runChat(userText) {
  if (busy) return;
  const text = userText.trim();
  if (!text) return;

  busy = true;
  let assistantBubble = null;
  let typewriter = null;
  let assistantText = "";
  let finalAssistantText = "";
  let buffer = "";

  try {
    settings = await requestJson("/api/settings");
    fillForm(settings);
    syncSpeechToggle();
    const currentSettings = settings;
    const enableSpeech = currentSettings.enable_gsv_tts !== false;
    const speechSyncText = enableSpeech && currentSettings.text_display_mode !== "text_first";

    if (enableSpeech) {
      setStatus("检查 GSV 连接");
      await assertGsvReady();
      await ensureAudioContext().catch(() => {});
    }

    setStatus("回复生成中");
    appendMessage("user", text);
    assistantBubble = createStreamingMessage("assistant");
    typewriter = createTypewriter(assistantBubble, { speech: enableSpeech });
    typewriter.setWaiting(true);
    messageInput.value = "";

    const revealAssistantText = (delta) => {
      if (!delta) return;
      if (!speechSyncText) assistantText += delta;
      typewriter.push(delta);
    };

    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history, speak: enableSpeech }),
    });
    if (!response.ok || !response.body) {
      const payload = await response.text();
      throw new Error(payload || "流式请求失败");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.event === "text_delta") {
          revealAssistantText(event.delta || "");
        } else if (event.event === "audio_start") {
          createInlineAudioStream(
            event.audio_id,
            event.text || "",
            speechSyncText ? revealAssistantText : null,
          );
          setStatus("语音合成中");
        } else if (event.event === "audio_chunk") {
          await pushInlineAudioChunk(event.audio_id, event.audio_base64);
        } else if (event.event === "audio_end") {
          await finishInlineAudioStream(event.audio_id);
        } else if (event.event === "audio_stream") {
          enqueueAudio(event.audio_url);
          setStatus("语音播放中");
        } else if (event.event === "audio") {
          enqueueAudio(event);
          setStatus("语音播放中");
        } else if (event.event === "audio_error") {
          if (event.audio_id) inlineAudioStreams.delete(event.audio_id);
          if (speechSyncText && event.text) revealAssistantText(event.text);
          setStatus(event.message || "语音合成失败");
        } else if (event.event === "error") {
          throw new Error(event.message);
        } else if (event.event === "done") {
          finalAssistantText = event.assistant_text || finalAssistantText;
        }
      }
    }

    if (buffer.trim()) {
      const event = JSON.parse(buffer);
      if (event.event === "done") {
        finalAssistantText = event.assistant_text || finalAssistantText;
      }
    }

    if (typewriter) {
      if (speechSyncText) {
        await waitForScheduledAudioEnd();
      }
      await typewriter.finish(speechSyncText ? "" : finalAssistantText || assistantText);
    }
    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: finalAssistantText || assistantText });
    const audioStillPlaying = audioContext && streamPlaybackTime > audioContext.currentTime + 0.2;
    setStatus(audioStillPlaying || audioPlaying || audioQueue.length > 0 ? "语音播放中" : "完成");
    if (audioStillPlaying) markCompleteAfterInlineAudio();
  } catch (error) {
    if (assistantBubble) {
      assistantBubble.textContent = assistantText ? `${assistantText}\n\n出错：${error.message}` : `出错：${error.message}`;
    } else {
      appendMessage("assistant", `出错：${error.message}`);
    }
    setStatus("出错");
  } finally {
    busy = false;
  }
}

function chooseMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""];
  return candidates.find((type) => !type || MediaRecorder.isTypeSupported(type)) || "";
}

async function startRecording() {
  if (busy) return;
  await ensureAudioContext().catch(() => {});
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  chunks = [];
  const mimeType = chooseMimeType();
  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = async () => {
    stream.getTracks().forEach((track) => track.stop());
    recordButton.classList.remove("recording");
    recordIcon.textContent = "●";
    await transcribeAndChat(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
  };
  recorder.start();
  recordButton.classList.add("recording");
  recordIcon.textContent = "■";
  setStatus("录音中");
}

function stopRecording() {
  if (recorder && recorder.state === "recording") {
    recorder.stop();
  }
}

async function transcribeAndChat(blob) {
  if (busy) return;
  busy = true;
  setStatus("识别中");
  try {
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");
    const asr = await requestJson(`/api/asr?language=${encodeURIComponent(form.elements.asr_language.value || "zh")}`, {
      method: "POST",
      body: formData,
    });
    busy = false;
    await runChat(asr.text || "");
  } catch (error) {
    appendMessage("assistant", `出错：${error.message}`);
    setStatus("出错");
    busy = false;
  }
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add("active");
  });
});

document.querySelector("#saveSettings").addEventListener("click", () => {
  saveSettings().catch((error) => setStatus(`保存失败：${error.message}`));
});

if (speechToggle) {
  speechToggle.addEventListener("change", async () => {
    const wantsSpeech = speechToggle.checked;
    try {
      if (wantsSpeech) {
        setStatus("检查 GSV 连接");
        await assertGsvReady();
      }
      await saveSpeechSetting(wantsSpeech);
      setStatus(wantsSpeech ? "语音已开启" : "语音已关闭");
    } catch (error) {
      speechToggle.checked = false;
      await saveSpeechSetting(false).catch(() => {});
      setStatus(`语音开启失败：${error.message}`);
    }
  });
}

document.querySelector("#checkGsv").addEventListener("click", async () => {
  try {
    await saveSettings(false);
    const health = await requestJson("/api/health");
    const gsv = health.gsv.health || {};
    setGsvStatus(
      gsv.ok ? `GSV 已连接：${gsv.service || gsv.url || ""}` : `GSV 未连接：${gsv.error || gsv.message || gsv.status_code || "未知状态"}`,
      gsv.ok ? "ok" : "error",
    );
  } catch (error) {
    setGsvStatus(`检查失败：${error.message}`, "error");
  }
});

document.querySelector("#startGsv").addEventListener("click", async () => {
  try {
    setGsvStatus("正在启动并预热 GSV", "pending");
    const current = readForm();
    const result = await requestJson("/api/gsv/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: current }),
    });
    settings = current;
    const warmupText = result.warmup ? `，预热 ${result.warmup.elapsed_seconds}s` : "";
    setGsvStatus(result.already_running ? `GSV 已在运行${warmupText}` : `GSV 已启动${warmupText}`, "ok");
  } catch (error) {
    setGsvStatus(`启动失败：${error.message}`, "error");
  }
});

document.querySelector("#stopGsv").addEventListener("click", async () => {
  try {
    const result = await requestJson("/api/gsv/stop", { method: "POST" });
    setGsvStatus(result.stopped ? "GSV 已停止" : "没有由本页面启动的 GSV 进程", result.stopped ? "ok" : "neutral");
  } catch (error) {
    setGsvStatus(`停止失败：${error.message}`, "error");
  }
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runChat(messageInput.value);
});

recordButton.addEventListener("click", () => {
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    setStatus("浏览器不支持录音");
    return;
  }
  if (recorder && recorder.state === "recording") {
    stopRecording();
  } else {
    startRecording().catch((error) => setStatus(`录音失败：${error.message}`));
  }
});

setupHelpTips();
loadSettings().catch((error) => setStatus(`加载设置失败：${error.message}`));
