const form = document.querySelector("#settingsForm");
const statusText = document.querySelector("#statusText");
const messages = document.querySelector("#messages");
const chatForm = document.querySelector("#chatForm");
const messageInput = document.querySelector("#messageInput");
const recordButton = document.querySelector("#recordButton");
const recordIcon = document.querySelector("#recordIcon");
const replyAudio = document.querySelector("#replyAudio");

let settings = {};
let history = [];
let recorder = null;
let chunks = [];
let busy = false;
let audioQueue = [];
let audioPlaying = false;

const numericFields = new Set([
  "openai_temperature",
  "top_k",
  "top_p",
  "tts_temperature",
  "speed_factor",
  "streaming_mode",
]);

function setStatus(text) {
  statusText.textContent = text;
}

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

function enqueueAudio(audioUrl) {
  if (!audioUrl) return;
  audioQueue.push(audioUrl);
  playNextAudio();
}

function playNextAudio() {
  if (audioPlaying || audioQueue.length === 0) return;
  audioPlaying = true;
  replyAudio.src = audioQueue.shift();
  replyAudio.play().catch(() => {
    audioPlaying = false;
    playNextAudio();
  });
}

replyAudio.addEventListener("ended", () => {
  audioPlaying = false;
  playNextAudio();
});

function readForm() {
  const data = {};
  new FormData(form).forEach((value, key) => {
    data[key] = numericFields.has(key) ? Number(value) : value;
  });
  return data;
}

function fillForm(data) {
  for (const [key, value] of Object.entries(data)) {
    const field = form.elements[key];
    if (field) field.value = value ?? "";
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

async function loadSettings() {
  settings = await requestJson("/api/settings");
  fillForm(settings);
  showEmpty();
}

async function saveSettings(announce = true) {
  settings = await requestJson("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings: readForm() }),
  });
  fillForm(settings);
  if (announce) setStatus("设置已保存");
}

async function runChat(userText) {
  if (busy) return;
  const text = userText.trim();
  if (!text) return;

  busy = true;
  setStatus("模型输出中");
  appendMessage("user", text);
  const assistantBubble = createStreamingMessage("assistant");
  let assistantText = "";
  let buffer = "";
  messageInput.value = "";

  try {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history, speak: true }),
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
          assistantText += event.delta || "";
          assistantBubble.textContent = assistantText;
          messages.scrollTop = messages.scrollHeight;
        } else if (event.event === "audio") {
          enqueueAudio(event.audio_url);
          setStatus("播放语音中");
        } else if (event.event === "audio_error") {
          setStatus(`分段合成失败：${event.message}`);
        } else if (event.event === "error") {
          throw new Error(event.message);
        } else if (event.event === "done") {
          assistantText = event.assistant_text || assistantText;
          assistantBubble.textContent = assistantText;
        }
      }
    }

    if (buffer.trim()) {
      const event = JSON.parse(buffer);
      if (event.event === "done") {
        assistantText = event.assistant_text || assistantText;
        assistantBubble.textContent = assistantText;
      }
    }

    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: assistantText });
    setStatus("完成");
  } catch (error) {
    assistantBubble.textContent = assistantText ? `${assistantText}\n\n出错：${error.message}` : `出错：${error.message}`;
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

document.querySelector("#checkGsv").addEventListener("click", async () => {
  try {
    await saveSettings(false);
    const health = await requestJson("/api/health");
    const gsv = health.gsv.health || {};
    setStatus(gsv.ok ? "GSV 已连接" : `GSV 未连接：${gsv.error || gsv.status_code || "未知状态"}`);
  } catch (error) {
    setStatus(`检查失败：${error.message}`);
  }
});

document.querySelector("#startGsv").addEventListener("click", async () => {
  try {
    setStatus("正在启动 GSV");
    const current = readForm();
    const result = await requestJson("/api/gsv/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: current }),
    });
    settings = current;
    setStatus(result.already_running ? "GSV 已在运行" : "GSV 已启动");
  } catch (error) {
    setStatus(`启动失败：${error.message}`);
  }
});

document.querySelector("#stopGsv").addEventListener("click", async () => {
  try {
    const result = await requestJson("/api/gsv/stop", { method: "POST" });
    setStatus(result.stopped ? "GSV 已停止" : "没有由本页面启动的 GSV 进程");
  } catch (error) {
    setStatus(`停止失败：${error.message}`);
  }
});

document.querySelector("#applyModels").addEventListener("click", async () => {
  try {
    const current = readForm();
    await requestJson("/api/gsv/apply-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: current }),
    });
    settings = current;
    setStatus("GSV 模型已应用");
  } catch (error) {
    setStatus(`应用失败：${error.message}`);
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

loadSettings().catch((error) => setStatus(`加载设置失败：${error.message}`));
