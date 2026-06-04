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
  } catch (error) {
    statusBox.textContent = `加载失败：${error.message}`;
    appLogBox.textContent = "";
    gsvLogBox.textContent = "";
  }
}

document.querySelector("#refreshAdmin").addEventListener("click", refreshAdmin);
refreshAdmin();
