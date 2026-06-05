async function requestJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify(payload, null, 2));
  }
  return payload;
}

async function refreshAdmin() {
  const statusBox = document.querySelector("#statusBox");
  const appLogBox = document.querySelector("#appLogBox");
  const gsvLogBox = document.querySelector("#gsvLogBox");
  const adminStatus = document.querySelector("#adminStatus");
  if (!statusBox || !appLogBox || !gsvLogBox) return;

  if (adminStatus) adminStatus.textContent = "刷新中";
  statusBox.textContent = "加载中...";
  appLogBox.textContent = "加载中...";
  gsvLogBox.textContent = "加载中...";

  try {
    const [status, logs] = await Promise.all([
      requestJson("/api/admin/status"),
      requestJson("/api/admin/logs"),
    ]);
    statusBox.textContent = JSON.stringify(status, null, 2);
    appLogBox.textContent = logs.app || "暂无应用日志";
    gsvLogBox.textContent = logs.gsv || "暂无 GSV 日志";
    if (adminStatus) adminStatus.textContent = "刷新完成";
  } catch (error) {
    statusBox.textContent = `加载失败：${error.message}`;
    appLogBox.textContent = "";
    gsvLogBox.textContent = "";
    if (adminStatus) adminStatus.textContent = "刷新失败";
  }
}

function initAdmin() {
  document.querySelector("#refreshAdmin")?.addEventListener("click", refreshAdmin);
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type !== "admin-status") return;
    const adminStatus = document.querySelector("#adminStatus");
    if (adminStatus) adminStatus.textContent = event.data.text || "待机";
  });
  refreshAdmin();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdmin);
} else {
  initAdmin();
}
