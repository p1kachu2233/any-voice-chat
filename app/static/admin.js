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
  if (!statusBox || !appLogBox || !gsvLogBox) return;

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

function activateAdminTab(name, updateHash = true) {
  const tabName = name || "settings";
  document.querySelectorAll(".admin-tab").forEach((item) => {
    item.classList.toggle("active", item.getAttribute("data-admin-tab") === tabName);
  });
  document.querySelectorAll(".admin-tab-panel").forEach((item) => {
    item.classList.toggle("active", item.getAttribute("data-admin-panel") === tabName);
  });
  if (updateHash) {
    window.history.replaceState(null, "", `#${tabName}`);
  }
}

function initAdmin() {
  document.querySelector("#refreshAdmin")?.addEventListener("click", refreshAdmin);
  document.querySelectorAll(".admin-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activateAdminTab(tab.getAttribute("data-admin-tab"));
    });
  });

  const initialTab = (window.location.hash || "#settings").slice(1);
  activateAdminTab(initialTab, false);
  refreshAdmin();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdmin);
} else {
  initAdmin();
}
