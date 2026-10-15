"use strict";
window.FC = (() => {
  let csrfToken = "", authEpoch = 0;
  async function request(route, { method = "GET", body } = {}) {
    const epoch = authEpoch;
    const headers = { Accept: "application/json" };
    if (method !== "GET") { headers["Content-Type"] = "application/json"; headers["X-FriendCode-Request"] = "1"; if (csrfToken) headers["X-CSRF-Token"] = csrfToken; }
    let response;
    try { response = await fetch(`api/${route}`, { method, headers, credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15_000), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
    catch { throw new Error("无法连接服务器，请检查网络后重试；写入操作不会自动重试。"); }
    let result;
    try { result = await response.json(); } catch { throw new Error("服务器返回了无效响应，请检查部署配置。"); }
    if (!response.ok || result.ok === false) {
      const error = new Error(result.error || "操作失败，请重试。"); error.status = response.status;
      if (response.status === 401 && route !== "login" && epoch === authEpoch) window.dispatchEvent(new Event("fc-session-expired"));
      throw error;
    }
    const rotatesSession = ["login","register","password"].includes(route);
    if (typeof result.csrfToken === "string" && (rotatesSession || epoch === authEpoch)) { csrfToken = result.csrfToken; if(rotatesSession)authEpoch++; }
    if(route === "logout"){csrfToken="";authEpoch++;}
    return result;
  }
  return {
    request,
    bootstrap: () => request("session"),
    clear: () => { csrfToken = ""; authEpoch++; },
    escape: value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])),
    async copy(text) {
      try { await navigator.clipboard.writeText(text); return; } catch { /* HTTP/local fallback. */ }
      const input = document.createElement("textarea"); input.value = text; input.className = "clipboard-helper";
      document.body.appendChild(input); input.select();
      try { if (!document.execCommand("copy")) throw new Error("无法自动复制，请手动选择并复制。"); }
      finally { input.remove(); }
    },
  };
})();
