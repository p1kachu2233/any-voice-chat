const form = document.querySelector("#settingsForm");
const statusText = document.querySelector("#statusText");
const messages = document.querySelector("#messages");
const chatForm = document.querySelector("#chatForm");
const messageInput = document.querySelector("#messageInput");
const recordButton = document.querySelector("#recordButton");
const recordIcon = document.querySelector("#recordIcon");
const replyAudio = document.querySelector("#replyAudio");
const speechToggle = document.querySelector("#speechToggle");
const preloadVoiceButton = document.querySelector("#preloadVoice");
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
let lastAssistantAudioScheduledAt = 0;
let voiceMode = false;
let vadStream = null;
let vadAudioContext = null;
let vadAnalyser = null;
let vadData = null;
let vadFrameId = null;
let micVad = null;
let micVadConfigKey = "";
let rmsSource = null;
let vadSpeaking = false;
let vadSilenceStartedAt = 0;
let vadSpeechStartedAt = 0;
let vadLastSubmitAt = 0;
let vadPreChunks = [];
let vadCaptureActive = false;
let vadFinalizeTimer = null;
let pendingRmsFinalize = false;
let voiceInputSerial = 0;
let asrBusy = false;
let currentAsrController = null;
let currentAsrRequestId = null;
let currentChatController = null;
let currentChatRequestId = null;
let currentChatInterrupted = false;
let currentTypewriter = null;
let activeChatId = 0;
let activeChatRun = null;
let voiceDraftBubble = null;
let voiceDraftText = "";
let pageCleanupDone = false;
const inlineAudioStreams = new Map();
const activeAudioSources = new Set();
const VAD_THRESHOLD = 0.055;
const VAD_NOISE_MULTIPLIER = 3.2;
const VAD_NOISE_OFFSET = 0.025;
const VAD_ASSISTANT_THRESHOLD = 0.095;
const VAD_ASSISTANT_NOISE_MULTIPLIER = 5.2;
const VAD_ASSISTANT_NOISE_OFFSET = 0.052;
const VAD_START_FRAMES = 6;
const VAD_SILENCE_MS = 1000;
const VAD_MIN_SPEECH_MS = 500;
const VAD_COOLDOWN_MS = 900;
const VAD_PRE_BUFFER_MS = 500;
const VAD_RECORDER_TIMESLICE_MS = 200;
let vadNoiseFloor = 0.012;
let vadVoiceHitFrames = 0;

const numericFields = new Set([
  "openai_temperature",
  "top_k",
  "top_p",
  "tts_temperature",
  "speed_factor",
  "streaming_mode",
  "tts_min_segment_chars",
  "tts_soft_segment_chars",
  "tts_force_segment_chars",
  "vad_web_positive_threshold",
  "vad_web_negative_threshold",
  "vad_web_redemption_ms",
  "vad_web_pre_speech_pad_ms",
  "vad_web_min_speech_ms",
  "vad_web_cooldown_ms",
  "rms_vad_threshold",
  "rms_vad_noise_multiplier",
  "rms_vad_noise_offset",
  "rms_vad_assistant_threshold",
  "rms_vad_assistant_noise_multiplier",
  "rms_vad_assistant_noise_offset",
  "rms_vad_start_frames",
  "rms_vad_silence_ms",
  "rms_vad_min_speech_ms",
  "rms_vad_cooldown_ms",
]);
const optionalNumericFields = new Set([
  "openai_top_p",
  "openai_top_k",
  "openai_frequency_penalty",
  "openai_presence_penalty",
  "openai_repetition_penalty",
  "openai_max_tokens",
  "openai_seed",
]);
const checkboxFields = new Set(["enable_gsv_tts", "auto_preload_vad", "auto_preload_asr"]);
const defaultFormValues = {
  openai_temperature: 0.7,
  openai_top_p: 0.9,
  openai_top_k: 40,
  openai_frequency_penalty: 0.2,
  openai_presence_penalty: 0.1,
  openai_repetition_penalty: 1.05,
  openai_max_tokens: 1024,
  openai_seed: "",
  openai_thinking_mode: "auto",
  tts_min_segment_chars: 10,
  tts_soft_segment_chars: 60,
  tts_force_segment_chars: 90,
  text_display_mode: "speech_sync",
  vad_engine: "vad_web",
  vad_web_positive_threshold: 0.5,
  vad_web_negative_threshold: 0.35,
  vad_web_redemption_ms: 1000,
  vad_web_pre_speech_pad_ms: 500,
  vad_web_min_speech_ms: 500,
  vad_web_cooldown_ms: VAD_COOLDOWN_MS,
  rms_vad_threshold: VAD_THRESHOLD,
  rms_vad_noise_multiplier: VAD_NOISE_MULTIPLIER,
  rms_vad_noise_offset: VAD_NOISE_OFFSET,
  rms_vad_assistant_threshold: VAD_ASSISTANT_THRESHOLD,
  rms_vad_assistant_noise_multiplier: VAD_ASSISTANT_NOISE_MULTIPLIER,
  rms_vad_assistant_noise_offset: VAD_ASSISTANT_NOISE_OFFSET,
  rms_vad_start_frames: VAD_START_FRAMES,
  rms_vad_silence_ms: VAD_SILENCE_MS,
  rms_vad_min_speech_ms: VAD_MIN_SPEECH_MS,
  rms_vad_cooldown_ms: VAD_COOLDOWN_MS,
  auto_preload_vad: false,
  auto_preload_asr: false,
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

function updateVoiceDraft(text, pending = true) {
  clearEmpty();
  voiceDraftText = text || "";
  if (!voiceDraftBubble) {
    const item = document.createElement("div");
    item.className = "message user voice-draft";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    item.appendChild(bubble);
    messages.appendChild(item);
    voiceDraftBubble = bubble;
  }
  voiceDraftBubble.textContent = voiceDraftText || (pending ? "..." : "");
  voiceDraftBubble.parentElement.classList.toggle("pending", pending);
  messages.scrollTop = messages.scrollHeight;
}

function finalizeVoiceDraft(text) {
  if (!voiceDraftBubble) {
    appendMessage("user", text);
    return;
  }
  voiceDraftBubble.textContent = text;
  voiceDraftBubble.parentElement.classList.remove("voice-draft", "pending");
  voiceDraftBubble = null;
  voiceDraftText = "";
  messages.scrollTop = messages.scrollHeight;
}

function clearVoiceDraft() {
  if (voiceDraftBubble) {
    voiceDraftBubble.parentElement.remove();
  }
  voiceDraftBubble = null;
  voiceDraftText = "";
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

  const currentText = () => visible + pending;

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
      const current = currentText();
      if (finalText && finalText !== current) {
        if (finalText.startsWith(current)) {
          pending += finalText.slice(current.length);
        } else if (!current) {
          pending += finalText;
        }
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
    cancel() {
      waiting = false;
      pending = "";
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
      render();
      resolveIdle();
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
      setStatus(voiceMode ? "监听中" : "完成");
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
  activeAudioSources.add(source);
  source.onended = () => activeAudioSources.delete(source);
  source.start(startTime);
  lastAssistantAudioScheduledAt = performance.now();
  streamPlaybackTime += buffer.duration;
  return { frames: frameCount, startTime };
}

function isActiveChatRun(chatRun) {
  return !!chatRun && activeChatRun === chatRun && !chatRun.interrupted;
}

function createInlineAudioStream(audioId, text = "", onPlaybackStart = null, isActive = null) {
  inlineAudioStreams.set(audioId, {
    pending: new Uint8Array(0),
    format: null,
    chunks: [],
    scheduledFrames: 0,
    receivedBytes: 0,
    text,
    onPlaybackStart,
    isActive,
    textRevealed: false,
  });
}

function revealInlineTextAtPlayback(ctx, state, startTime) {
  if (!state.text || !state.onPlaybackStart || state.textRevealed) return;
  if (state.isActive && !state.isActive()) return;
  state.textRevealed = true;
  const delayMs = Math.max(0, startTime - ctx.currentTime) * 1000;
  window.setTimeout(() => {
    if (state.isActive && !state.isActive()) return;
    state.onPlaybackStart(state.text);
  }, delayMs);
}

async function pushInlineAudioChunk(audioId, audioBase64, chatRun = null) {
  const ctx = await ensureAudioContext();
  if (chatRun && !isActiveChatRun(chatRun)) return;
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
      isActive: chatRun ? () => isActiveChatRun(chatRun) : null,
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

  if (chatRun && !isActiveChatRun(chatRun)) return;
  const frames = drainInlineAudioState(ctx, state, false);
  if (frames > 0) setStatus("语音播放中");
}

async function finishInlineAudioStream(audioId, chatRun = null) {
  const ctx = await ensureAudioContext();
  if (chatRun && !isActiveChatRun(chatRun)) return;
  const state = inlineAudioStreams.get(audioId);
  if (state) {
    if (state.isActive && !state.isActive()) {
      inlineAudioStreams.delete(audioId);
      return;
    }
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

function stopAudioPlayback() {
  audioQueue = [];
  inlineAudioStreams.clear();
  if (replyAudio) {
    replyAudio.pause();
    replyAudio.removeAttribute("src");
    replyAudio.load();
  }
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = null;
  activeAudioSources.forEach((source) => {
    try {
      source.stop();
    } catch (error) {
      // Already stopped.
    }
  });
  activeAudioSources.clear();
  if (audioContext) {
    streamPlaybackTime = audioContext.currentTime;
  } else {
    streamPlaybackTime = 0;
  }
  lastAssistantAudioScheduledAt = 0;
  audioPlaying = false;
}

function interruptAssistant(reason = "interrupted") {
  const chatRun = activeChatRun;
  if (chatRun) chatRun.interrupted = true;
  currentChatInterrupted = true;
  activeChatId += 1;
  cancelCurrentChat(chatRun);
  cancelCurrentAsr();
  if (chatRun?.controller) {
    chatRun.controller.abort();
  } else if (currentChatController) {
    currentChatController.abort();
  }
  if (currentTypewriter) {
    currentTypewriter.cancel();
  }
  if (activeChatRun === chatRun) activeChatRun = null;
  currentChatController = null;
  currentTypewriter = null;
  stopAudioPlayback();
  busy = false;
  setStatus(reason === "speech" ? "已打断，正在听你说话" : "已打断");
}

function makeChatRequestId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cancelCurrentChat(chatRun = activeChatRun) {
  const requestId = chatRun?.requestId || currentChatRequestId;
  if (!requestId) return;
  sendCancelRequest(`/api/chat/cancel/${encodeURIComponent(requestId)}`);
  if (chatRun) chatRun.requestId = null;
  if (currentChatRequestId === requestId) currentChatRequestId = null;
}

function makeAsrRequestId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cancelCurrentAsr() {
  if (currentAsrRequestId) {
    sendCancelRequest(`/api/asr/cancel/${encodeURIComponent(currentAsrRequestId)}`);
  }
  if (currentAsrController) {
    currentAsrController.abort();
  }
  currentAsrRequestId = null;
  currentAsrController = null;
}

function sendCancelRequest(url) {
  try {
    if (navigator.sendBeacon) {
      const empty = new Blob([], { type: "text/plain" });
      if (navigator.sendBeacon(url, empty)) return;
    }
  } catch (error) {
    // Fall back to fetch below.
  }
  fetch(url, {
    method: "POST",
    keepalive: true,
  }).catch(() => {});
}

function cleanupPageRequests() {
  if (pageCleanupDone) return;
  pageCleanupDone = true;
  const chatRun = activeChatRun;
  if (chatRun) chatRun.interrupted = true;
  currentChatInterrupted = true;
  activeChatId += 1;
  cancelCurrentChat(chatRun);
  cancelCurrentAsr();
  if (chatRun?.controller) {
    chatRun.controller.abort();
  } else if (currentChatController) {
    currentChatController.abort();
  }
  currentChatController = null;
  if (currentAsrController) {
    currentAsrController.abort();
    currentAsrController = null;
  }
  if (activeChatRun === chatRun) activeChatRun = null;
  if (currentTypewriter) {
    currentTypewriter.cancel();
    currentTypewriter = null;
  }
  stopAudioPlayback();
  if (voiceMode) {
    stopVoiceMode({ silent: true, keepVad: false });
  } else {
    destroyPreloadedVad();
  }
  busy = false;
  asrBusy = false;
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
    if (currentChatInterrupted || error.name === "AbortError") {
      setStatus(voiceMode ? "监听中" : "已打断");
      return;
    }
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
    if (optionalNumericFields.has(key)) {
      const text = String(value).trim();
      const numberValue = Number(text);
      if (text !== "" && numberValue === 0) {
        throw new Error(`${key} 不能为 0；清空表示不发送`);
      }
      data[key] = text === "" ? "" : numberValue;
    } else {
      data[key] = numericFields.has(key) ? Number(value) : value;
    }
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
  updateVadEnginePanels();
}

function updateVadEnginePanels() {
  const engine = form.elements.vad_engine?.value || settings.vad_engine || defaultFormValues.vad_engine;
  document.querySelectorAll("[data-vad-engine-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.vadEnginePanel !== engine;
  });
}

function runAutoPreload() {
  if (isSettingsOnly) return;
  if (settings.auto_preload_vad || settings.auto_preload_asr) {
    window.setTimeout(() => {
      preloadVoiceAssets({ vad: settings.auto_preload_vad, asr: settings.auto_preload_asr, announce: false });
    }, 300);
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
  runAutoPreload();
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

async function runChat(userText, options = {}) {
  if (busy) return;
  const text = userText.trim();
  if (!text) return;

  busy = true;
  currentChatInterrupted = false;
  const chatId = activeChatId + 1;
  activeChatId = chatId;
  const chatRequestId = makeChatRequestId();
  currentChatRequestId = chatRequestId;
  currentChatController = new AbortController();
  const chatRun = {
    chatId,
    requestId: chatRequestId,
    controller: currentChatController,
    interrupted: false,
  };
  activeChatRun = chatRun;
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
      stopAudioPlayback();
    }

    setStatus("回复生成中");
    if (options.useVoiceDraft) {
      finalizeVoiceDraft(text);
    } else {
      appendMessage("user", text);
    }
    assistantBubble = createStreamingMessage("assistant");
    typewriter = createTypewriter(assistantBubble, { speech: enableSpeech });
    currentTypewriter = typewriter;
    typewriter.setWaiting(true);
    messageInput.value = "";

    const revealAssistantText = (delta) => {
      if (!delta) return;
      if (!isActiveChatRun(chatRun)) return;
      if (!speechSyncText) assistantText += delta;
      typewriter.push(delta);
    };

    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history, speak: enableSpeech, chat_id: chatRequestId }),
      signal: chatRun.controller.signal,
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
      if (!isActiveChatRun(chatRun)) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        if (!isActiveChatRun(chatRun)) break;
        const event = JSON.parse(line);
        if (event.event === "text_delta") {
          revealAssistantText(event.delta || "");
        } else if (event.event === "audio_start") {
          createInlineAudioStream(
            event.audio_id,
            event.text || "",
            speechSyncText ? revealAssistantText : null,
            () => isActiveChatRun(chatRun),
          );
          setStatus("语音合成中");
        } else if (event.event === "audio_chunk") {
          await pushInlineAudioChunk(event.audio_id, event.audio_base64, chatRun);
        } else if (event.event === "audio_end") {
          await finishInlineAudioStream(event.audio_id, chatRun);
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

    if (!isActiveChatRun(chatRun)) {
      return;
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
    setStatus(audioStillPlaying || audioPlaying || audioQueue.length > 0 ? "语音播放中" : voiceMode ? "监听中" : "完成");
    if (audioStillPlaying) markCompleteAfterInlineAudio();
  } catch (error) {
    if (chatRun.interrupted || error.name === "AbortError") {
      setStatus(voiceMode ? "监听中" : "已打断");
      return;
    }
    if (options.useVoiceDraft && voiceDraftBubble) {
      finalizeVoiceDraft(text);
    }
    if (assistantBubble) {
      assistantBubble.textContent = assistantText ? `${assistantText}\n\n出错：${error.message}` : `出错：${error.message}`;
    } else {
      appendMessage("assistant", `出错：${error.message}`);
    }
    setStatus("出错");
  } finally {
    if (activeChatRun === chatRun) {
      busy = false;
      currentChatController = null;
      if (currentChatRequestId === chatRequestId) currentChatRequestId = null;
      currentTypewriter = null;
      currentChatInterrupted = false;
      activeChatRun = null;
    }
  }
}

function chooseMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""];
  return candidates.find((type) => !type || MediaRecorder.isTypeSupported(type)) || "";
}

async function startRecording() {
  if (voiceMode) {
    stopVoiceMode();
    return;
  }
  await startVoiceMode();
  return;
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
  if (voiceMode) {
    stopVoiceMode();
    return;
  }
  if (recorder && recorder.state === "recording") {
    recorder.stop();
  }
}

function audioConstraints() {
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  };
}

function startLiveAsrCaption() {
  // Browser SpeechRecognition is intentionally disabled here because it
  // accumulates noisy interim text and can pick up the assistant's speaker audio.
}

function stopLiveAsrCaption() {
  // Kept as a no-op so voice-mode cleanup can call it safely.
}

function voiceLevel() {
  if (!vadAnalyser || !vadData) return 0;
  vadAnalyser.getByteTimeDomainData(vadData);
  let sum = 0;
  for (let index = 0; index < vadData.length; index += 1) {
    const value = (vadData[index] - 128) / 128;
    sum += value * value;
  }
  return Math.sqrt(sum / vadData.length);
}

function settingNumber(key, fallback) {
  const value = Number(settings[key]);
  return Number.isFinite(value) ? value : fallback;
}

function vadStartThreshold() {
  if (assistantPlaybackActive()) {
    return Math.max(
      settingNumber("rms_vad_assistant_threshold", VAD_ASSISTANT_THRESHOLD),
      vadNoiseFloor * settingNumber("rms_vad_assistant_noise_multiplier", VAD_ASSISTANT_NOISE_MULTIPLIER),
      vadNoiseFloor + settingNumber("rms_vad_assistant_noise_offset", VAD_ASSISTANT_NOISE_OFFSET),
    );
  }
  return Math.max(
    settingNumber("rms_vad_threshold", VAD_THRESHOLD),
    vadNoiseFloor * settingNumber("rms_vad_noise_multiplier", VAD_NOISE_MULTIPLIER),
    vadNoiseFloor + settingNumber("rms_vad_noise_offset", VAD_NOISE_OFFSET),
  );
}

function assistantPlaybackActive() {
  if (audioPlaying || activeAudioSources.size > 0 || audioQueue.length > 0) return true;
  if (audioContext && streamPlaybackTime > audioContext.currentTime + 0.05) return true;
  return performance.now() - lastAssistantAudioScheduledAt < 500;
}

function beginVoiceUtterance(now, options = {}) {
  const cooldownKey = options.externalCapture ? "vad_web_cooldown_ms" : "rms_vad_cooldown_ms";
  if (!voiceMode || vadSpeaking || now - vadLastSubmitAt < settingNumber(cooldownKey, VAD_COOLDOWN_MS)) {
    return false;
  }
  vadSpeaking = true;
  const utteranceSerial = voiceInputSerial + 1;
  voiceInputSerial = utteranceSerial;
  vadSpeechStartedAt = now;
  vadSilenceStartedAt = 0;
  vadVoiceHitFrames = 0;
  chunks = [];
  vadCaptureActive = true;
  pendingRmsFinalize = false;
  updateVoiceDraft("", true);
  interruptAssistant("speech");
  if (!options.externalCapture) {
    startRmsUtteranceRecorder();
  }

  recordButton.classList.add("recording");
  setStatus("正在听你说话");
  return true;
}

function startRmsUtteranceRecorder() {
  if (!vadStream || !window.MediaRecorder) return;
  const mimeType = chooseMimeType();
  recorder = new MediaRecorder(vadStream, mimeType ? { mimeType } : undefined);
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };
  recorder.onstop = () => {
    if (pendingRmsFinalize) {
      finalizeRmsVoiceUtterance();
    }
  };
  recorder.start();
}

async function submitVoiceBlob(blob, voiceSerial) {
  if (!voiceMode || !blob || blob.size <= 0) {
    if (voiceMode) setStatus("监听中");
    return;
  }
  vadLastSubmitAt = performance.now();
  await transcribeAndChat(blob, { autoVoice: true, voiceSerial });
}

async function finalizeRmsVoiceUtterance() {
  const elapsed = performance.now() - vadSpeechStartedAt;
  const mimeType = recorder?.mimeType || "audio/webm";
  const blob = new Blob(chunks, { type: mimeType });
  const voiceSerial = voiceInputSerial;
  vadCaptureActive = false;
  pendingRmsFinalize = false;
  chunks = [];
  if (voiceMode && elapsed >= settingNumber("rms_vad_min_speech_ms", VAD_MIN_SPEECH_MS) && blob.size > 0) {
    await submitVoiceBlob(blob, voiceSerial);
  } else if (voiceMode) {
    setStatus("监听中");
  }
}

async function finalizeVadWebVoiceUtterance(audio) {
  const elapsed = performance.now() - vadSpeechStartedAt;
  const voiceSerial = voiceInputSerial;
  vadSpeaking = false;
  vadCaptureActive = false;
  recordButton.classList.remove("recording");
  if (!voiceMode || elapsed < settingNumber("vad_web_min_speech_ms", VAD_MIN_SPEECH_MS)) {
    if (voiceMode) setStatus("监听中");
    return;
  }
  try {
    const wavBuffer = window.vad?.utils?.encodeWAV
      ? window.vad.utils.encodeWAV(audio, 1, 16000, 1, 16)
      : encodeFloat32Wav(audio, 16000);
    await submitVoiceBlob(new Blob([wavBuffer], { type: "audio/wav" }), voiceSerial);
  } catch (error) {
    appendMessage("assistant", `出错：${error.message}`);
    setStatus("出错");
  }
}

function encodeFloat32Wav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let index = 0; index < samples.length; index += 1, offset += 2) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

function endVoiceUtterance() {
  if (!vadSpeaking) return;
  vadSpeaking = false;
  vadSilenceStartedAt = 0;
  vadVoiceHitFrames = 0;
  recordButton.classList.remove("recording");
  if (recorder && recorder.state === "recording") {
    pendingRmsFinalize = true;
    recorder.stop();
  } else {
    finalizeRmsVoiceUtterance();
  }
}

function tickVoiceActivity() {
  if (!voiceMode) return;
  const now = performance.now();
  const level = voiceLevel();
  const threshold = vadStartThreshold();
  if (!vadSpeaking) {
    vadNoiseFloor = vadNoiseFloor * 0.96 + Math.min(level, threshold) * 0.04;
  }
  if (level >= threshold) {
    if (vadSpeaking) {
      vadSilenceStartedAt = 0;
    } else {
      vadVoiceHitFrames += 1;
    }
    if (!vadSpeaking && vadVoiceHitFrames >= settingNumber("rms_vad_start_frames", VAD_START_FRAMES)) {
      beginVoiceUtterance(now);
    }
  } else if (vadSpeaking) {
    if (!vadSilenceStartedAt) vadSilenceStartedAt = now;
    if (now - vadSilenceStartedAt >= settingNumber("rms_vad_silence_ms", VAD_SILENCE_MS)) {
      endVoiceUtterance();
    }
  } else {
    vadVoiceHitFrames = 0;
  }
  vadFrameId = window.requestAnimationFrame(tickVoiceActivity);
}

async function startVoiceMode() {
  if (!navigator.mediaDevices) {
    setStatus("浏览器不支持麦克风");
    return;
  }
  await ensureAudioContext().catch(() => {});
  settings = await requestJson("/api/settings").catch(() => settings);
  const engine = settings.vad_engine || "vad_web";
  if (engine === "vad_web" && window.vad?.MicVAD) {
    try {
      await startVadWebVoiceMode();
      return;
    } catch (error) {
      console.warn("vad-web failed, falling back to RMS VAD", error);
      voiceMode = false;
      vadSpeaking = false;
      vadCaptureActive = false;
      setStatus(`vad-web 启动失败，已切换 RMS：${error.message}`);
      window.setTimeout(() => startRmsVoiceMode().catch((fallbackError) => setStatus(`语音启动失败：${fallbackError.message}`)), 200);
      return;
    }
  }
  await startRmsVoiceMode();
}

function vadWebConfigKey() {
  return JSON.stringify({
    positive: settingNumber("vad_web_positive_threshold", 0.5),
    negative: settingNumber("vad_web_negative_threshold", 0.35),
    redemption: settingNumber("vad_web_redemption_ms", 1000),
    preSpeechPad: settingNumber("vad_web_pre_speech_pad_ms", VAD_PRE_BUFFER_MS),
    minSpeech: settingNumber("vad_web_min_speech_ms", VAD_MIN_SPEECH_MS),
    cooldown: settingNumber("vad_web_cooldown_ms", VAD_COOLDOWN_MS),
  });
}

function destroyPreloadedVad() {
  if (!micVad) return;
  try {
    micVad.destroy();
  } catch (error) {
    // Ignore shutdown errors from the browser audio graph.
  }
  micVad = null;
  micVadConfigKey = "";
}

async function createMicVad() {
  return window.vad.MicVAD.new({
    model: "v5",
    baseAssetPath: "/static/vendor/vad-web/",
    onnxWASMBasePath: "/static/vendor/onnxruntime-web/",
    positiveSpeechThreshold: settingNumber("vad_web_positive_threshold", 0.5),
    negativeSpeechThreshold: settingNumber("vad_web_negative_threshold", 0.35),
    redemptionMs: settingNumber("vad_web_redemption_ms", 1000),
    preSpeechPadMs: settingNumber("vad_web_pre_speech_pad_ms", VAD_PRE_BUFFER_MS),
    minSpeechMs: settingNumber("vad_web_min_speech_ms", VAD_MIN_SPEECH_MS),
    startOnLoad: false,
    getStream: async () => navigator.mediaDevices.getUserMedia(audioConstraints()),
    onSpeechStart: () => {
      beginVoiceUtterance(performance.now(), { externalCapture: true });
    },
    onSpeechEnd: (audio) => {
      if (vadCaptureActive) {
        finalizeVadWebVoiceUtterance(audio);
      } else if (voiceMode) {
        setStatus("监听中");
      }
    },
    onVADMisfire: () => {
      vadSpeaking = false;
      vadCaptureActive = false;
      recordButton.classList.remove("recording");
      if (voiceMode) setStatus("监听中");
    },
    ortConfig: (ort) => {
      ort.env.logLevel = "error";
    },
  });
}

async function preloadVadWeb(options = {}) {
  const announce = options.announce !== false;
  settings = await requestJson("/api/settings").catch(() => settings);
  if ((settings.vad_engine || "vad_web") !== "vad_web") {
    if (announce) setStatus("当前 VAD 引擎不是 vad-web");
    return false;
  }
  if (!window.vad?.MicVAD) {
    throw new Error("vad-web 静态资源未加载");
  }
  const configKey = vadWebConfigKey();
  if (micVad && micVadConfigKey === configKey) {
    if (announce) setStatus("VAD 已预加载");
    return true;
  }
  destroyPreloadedVad();
  if (announce) setStatus("正在预加载 VAD");
  micVad = await createMicVad();
  micVadConfigKey = configKey;
  if (announce) setStatus("VAD 已预加载");
  return true;
}

async function preloadAsr(options = {}) {
  const announce = options.announce !== false;
  if (announce) setStatus("正在预加载 ASR");
  await requestJson(`/api/asr/warmup?language=${encodeURIComponent(form.elements.asr_language.value || "zh")}`, {
    method: "POST",
  });
  if (announce) setStatus("ASR 已预加载");
}

async function preloadVoiceAssets(options = {}) {
  const preloadVad = options.vad !== false;
  const preloadAsrModel = options.asr !== false;
  const announce = options.announce !== false;
  try {
    if (announce) setStatus("正在预加载");
    const tasks = [];
    if (preloadVad) tasks.push(preloadVadWeb({ announce: false }));
    if (preloadAsrModel) tasks.push(preloadAsr({ announce: false }));
    await Promise.all(tasks);
    if (announce) setStatus("预加载完成");
  } catch (error) {
    setStatus(`预加载失败：${error.message}`);
  }
}

async function startVadWebVoiceMode() {
  voiceMode = true;
  vadSpeaking = false;
  vadSilenceStartedAt = 0;
  vadVoiceHitFrames = 0;
  vadCaptureActive = false;
  chunks = [];
  setStatus("正在加载 vad-web");
  await preloadVadWeb({ announce: false });
  if (!micVad) {
    throw new Error("VAD 未加载");
  }
  await micVad.start();
  recordButton.classList.add("listening");
  recordButton.title = "关闭连续语音输入";
  recordIcon.textContent = "●";
  setStatus("监听中");
  startLiveAsrCaption();
  requestJson(`/api/asr/warmup?language=${encodeURIComponent(form.elements.asr_language.value || "zh")}`, {
    method: "POST",
  }).catch(() => {});
}

async function startRmsVoiceMode() {
  if (!window.MediaRecorder) {
    throw new Error("浏览器不支持录音");
  }
  vadStream = await navigator.mediaDevices.getUserMedia(audioConstraints());
  vadAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  rmsSource = vadAudioContext.createMediaStreamSource(vadStream);
  vadAnalyser = vadAudioContext.createAnalyser();
  vadAnalyser.fftSize = 1024;
  vadData = new Uint8Array(vadAnalyser.fftSize);
  rmsSource.connect(vadAnalyser);
  voiceMode = true;
  vadSpeaking = false;
  vadSilenceStartedAt = 0;
  vadVoiceHitFrames = 0;
  vadNoiseFloor = 0.012;
  vadPreChunks = [];
  vadCaptureActive = false;
  chunks = [];
  recorder = null;
  recordButton.classList.add("listening");
  recordButton.title = "关闭连续语音输入";
  recordIcon.textContent = "●";
  setStatus("监听中");
  startLiveAsrCaption();
  requestJson(`/api/asr/warmup?language=${encodeURIComponent(form.elements.asr_language.value || "zh")}`, {
    method: "POST",
  }).catch(() => {});
  tickVoiceActivity();
}

function stopVoiceMode(options = {}) {
  voiceMode = false;
  if (vadFrameId) {
    window.cancelAnimationFrame(vadFrameId);
    vadFrameId = null;
  }
  if (micVad) {
    if (options.keepVad === false) {
      destroyPreloadedVad();
    } else {
      micVad.pause().catch(() => {});
    }
  }
  if (recorder && recorder.state === "recording") {
    vadCaptureActive = false;
    pendingRmsFinalize = false;
    recorder.stop();
  }
  if (vadFinalizeTimer) {
    window.clearTimeout(vadFinalizeTimer);
    vadFinalizeTimer = null;
  }
  if (vadStream) {
    vadStream.getTracks().forEach((track) => track.stop());
  }
  if (vadAudioContext) {
    vadAudioContext.close().catch(() => {});
  }
  stopLiveAsrCaption();
  vadStream = null;
  vadAudioContext = null;
  vadAnalyser = null;
  vadData = null;
  rmsSource = null;
  vadSpeaking = false;
  vadVoiceHitFrames = 0;
  vadPreChunks = [];
  chunks = [];
  vadCaptureActive = false;
  pendingRmsFinalize = false;
  recorder = null;
  if (!options.silent) {
    cancelCurrentAsr();
  }
  recordButton.classList.remove("listening", "recording");
  recordButton.title = "开启连续语音输入";
  recordIcon.textContent = "●";
  clearVoiceDraft();
  if (!options.silent) {
    setStatus("连续语音已关闭");
  }
}

async function transcribeAndChat(blob, options = {}) {
  if (busy) {
    interruptAssistant(options.autoVoice ? "speech" : "interrupted");
  }
  cancelCurrentAsr();
  asrBusy = true;
  const asrRequestId = makeAsrRequestId();
  currentAsrRequestId = asrRequestId;
  currentAsrController = new AbortController();
  setStatus("识别中");
  try {
    const formData = new FormData();
    const filename = blob.type.includes("wav") ? "recording.wav" : "recording.webm";
    formData.append("audio", blob, filename);
    const asr = await requestJson(
      `/api/asr?language=${encodeURIComponent(form.elements.asr_language.value || "zh")}&asr_id=${encodeURIComponent(asrRequestId)}`,
      {
        method: "POST",
        body: formData,
        signal: currentAsrController.signal,
      },
    );
    if (options.voiceSerial && options.voiceSerial !== voiceInputSerial) {
      asrBusy = false;
      return;
    }
    if (currentAsrRequestId !== asrRequestId) {
      asrBusy = false;
      return;
    }
    asrBusy = false;
    currentAsrRequestId = null;
    currentAsrController = null;
    const text = (asr.text || "").trim();
    if (!text) {
      clearVoiceDraft();
      setStatus(voiceMode ? "监听中" : "未识别到内容");
      return;
    }
    updateVoiceDraft(text, false);
    await runChat(text, { useVoiceDraft: true });
  } catch (error) {
    if (error.name === "AbortError") {
      asrBusy = false;
      setStatus(voiceMode ? "监听中" : "已打断");
      return;
    }
    appendMessage("assistant", `出错：${error.message}`);
    setStatus("出错");
    asrBusy = false;
  } finally {
    if (currentAsrRequestId === asrRequestId) {
      currentAsrRequestId = null;
      currentAsrController = null;
    }
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

if (form.elements.vad_engine) {
  form.elements.vad_engine.addEventListener("change", updateVadEnginePanels);
}

if (preloadVoiceButton) {
  preloadVoiceButton.addEventListener("click", () => {
    preloadVoiceAssets({ vad: true, asr: true, announce: true });
  });
}

window.addEventListener("pagehide", cleanupPageRequests);
window.addEventListener("beforeunload", cleanupPageRequests);

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
  if (!navigator.mediaDevices) {
    setStatus("浏览器不支持麦克风");
    return;
  }
  if (recorder && recorder.state === "recording") {
    stopRecording();
  } else {
    startRecording().catch((error) => setStatus(`录音失败：${error.message}`));
  }
});

recordButton.title = "开启连续语音输入";
setupHelpTips();
loadSettings().catch((error) => setStatus(`加载设置失败：${error.message}`));
