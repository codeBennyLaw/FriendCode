"use strict";
const $ = id => document.getElementById(id);
const state = { users: [], logs: [], selected: null, resetting: false, inviteCodes: [] };
const escape = FC.escape;
function status(message, error = false) {
  $("adminStatus").textContent = message; $("adminStatus").hidden = !message;
  $("adminStatus").classList.toggle("is-error", error);
}
function deny(message) {
  state.users = []; state.logs = []; state.inviteCodes = []; $("currentInviteCode").textContent = ""; $("inviteHistory").replaceChildren(); $("memberList").replaceChildren(); $("auditList").replaceChildren();
  $("adminContent").hidden = true; $("accessDenied").hidden = false; $("ownerLabel").textContent = "";
  if ($("resetDialog").open) $("resetDialog").close();
  if ($("inviteDialog").open) $("inviteDialog").close();
  status(message, true);
}
function renderUsers() {
  const query = $("memberSearch").value.trim().toLowerCase();
  const users = state.users.filter(user => `${user.qq} ${user.nick}`.toLowerCase().includes(query));
  $("resultCount").textContent = `找到 ${users.length} 个账号`;
  $("memberList").innerHTML = users.length ? users.map(user => `
    <article class="member-row">
      <div><div class="member-name">${escape(user.nick || "未设置昵称")}</div><div class="member-qq">QQ ${escape(user.qq)}</div>${user.mustChangePassword ? '<div class="member-state">下次登录需修改临时密码</div>' : ""}</div>
      <div class="member-codes">${user.entryCount} 条好友码</div>
      ${user.role === "admin" ? '<span class="member-owner">站长 · 自行改密</span>' : `<button class="btn" type="button" data-reset="${escape(user.qq)}" aria-label="重置账号 ${escape(user.qq)} 的密码">重置密码</button>`}
    </article>`).join("") : '<p class="admin-muted">没有匹配的群友。</p>';
  $("memberList").querySelectorAll("[data-reset]").forEach(button => button.addEventListener("click", () => {
    state.selected = state.users.find(user => user.qq === button.dataset.reset);
    $("resetTarget").textContent = `${state.selected.nick || "未设置昵称"} · QQ ${state.selected.qq}`;
    $("resetDescription").hidden = false; $("resetConfirmation").hidden = false;
    $("resetResult").hidden = true; $("resetError").hidden = true; $("temporaryPassword").value = "";
    $("copyPassword").textContent = "复制账号和临时密码";
    $("resetDialog").showModal(); $("resetCancel").focus();
  }));
}
function renderLogs() {
  const labels = { "password-reset": "站长重置了成员密码", "password-change": "用户修改了自己的密码", "register": "成员注册", "owner-created": "创建站长账号", "owner-recovery": "通过服务器恢复站长密码" };
  $("auditList").innerHTML = state.logs.length ? state.logs.map(log => `<li><span>${escape(labels[log.action] || "账号操作")} · ${escape(log.target)}</span><time datetime="${escape(log.at)}">${escape(new Date(log.at).toLocaleString("zh-CN"))}</time></li>`).join("") : '<li class="admin-muted">暂无操作记录。</li>';
}
async function load() {
  $("reloadUsers").disabled = true; $("memberList").setAttribute("aria-busy", "true");
  try {
    const session = await FC.bootstrap();
    if (!session.user || session.user.role !== "admin" || session.user.mustChangePassword) { deny("请使用站长账号登录后访问后台。"); return; }
    $("ownerLabel").textContent = session.user.nick || "站长";
    const [result, invites] = await Promise.all([FC.request("admin/users"), FC.request("admin/invite-codes")]); state.users = result.users; state.logs = result.logs; state.inviteCodes = invites.inviteCodes;
    $("memberCount").textContent = state.users.filter(user => user.role !== "admin").length;
    $("entryCount").textContent = result.entryCount;
    $("temporaryCount").textContent = state.users.filter(user => user.mustChangePassword).length;
    $("adminContent").hidden = false; $("accessDenied").hidden = true;
    renderUsers(); renderLogs(); renderInvites(); status("");
  } catch (error) { if (error.status === 401 || error.status === 403) deny(error.message); else status(error.message, true); }
  finally { $("reloadUsers").disabled = false; $("memberList").removeAttribute("aria-busy"); }
}
$("memberSearch").addEventListener("input", renderUsers);
$("reloadUsers").addEventListener("click", load);
$("resetCancel").addEventListener("click", () => $("resetDialog").close());
$("resetDone").addEventListener("click", () => $("resetDialog").close());
$("resetDialog").addEventListener("cancel", event => { if (state.resetting) event.preventDefault(); });
$("resetDialog").addEventListener("close", () => { $("temporaryPassword").value = ""; state.selected = null; $("resetError").textContent = ""; });
$("resetConfirm").addEventListener("click", async () => {
  if (state.resetting || !state.selected) return;
  state.resetting = true; $("resetConfirm").disabled = true; $("resetCancel").disabled = true;
  $("resetConfirm").setAttribute("aria-busy", "true"); $("resetError").hidden = true;
  const qq = state.selected.qq;
  try {
    const result = await FC.request(`admin/users/${encodeURIComponent(qq)}/reset-password`, { method: "POST", body: {} });
    $("temporaryPassword").value = result.temporaryPassword;
    $("resetConfirmation").hidden = true; $("resetDescription").hidden = true; $("resetResult").hidden = false;
    $("temporaryPassword").focus(); $("temporaryPassword").select();
    // Do not fail the successful reset or clear its only password display if refreshing the list fails.
    await load();
  } catch (error) { $("resetError").textContent = error.message; $("resetError").hidden = false; }
  finally { state.resetting = false; $("resetConfirm").disabled = false; $("resetCancel").disabled = false; $("resetConfirm").removeAttribute("aria-busy"); }
});
$("copyPassword").addEventListener("click", async () => {
  if (!state.selected || !$("temporaryPassword").value) return;
  try {
    await FC.copy(`QQ：${state.selected.qq}\n临时密码：${$("temporaryPassword").value}\n请登录后立即设置自己的新密码。`);
    $("copyPassword").textContent = "已复制，请私聊发给本人";
  } catch (error) { $("resetError").textContent = error.message; $("resetError").hidden = false; }
});
window.addEventListener("fc-session-expired", () => deny("登录已过期，请回到首页重新登录。"));
window.addEventListener("pagehide", () => { $("temporaryPassword").value = ""; $("newInviteCode").value = ""; });
function formatTime(value) { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
function renderInvites() {
  const active = state.inviteCodes.find(item => item.endedAt === null);
  $("currentInviteCode").textContent = active?.code || "未启用";
  $("copyInviteCode").disabled = !active;
  $("currentInvitePeriod").textContent = active ? `生效时间：${formatTime(active.startedAt)} — 至今` : "当前没有有效验证码。";
  $("inviteHistory").innerHTML = state.inviteCodes.map(item => `<article class="invite-history-row"><code>${escape(item.code)}</code><span class="admin-muted">${escape(formatTime(item.startedAt))} — ${item.endedAt ? escape(formatTime(item.endedAt)) : "至今 · 当前有效"}</span></article>`).join("");
}
$("copyInviteCode").addEventListener("click", async () => {
  const active = state.inviteCodes.find(item => item.endedAt === null); if (!active) return;
  try { await FC.copy(active.code); status("当前验证码已复制，请只分享给群友。"); } catch (error) { status(error.message, true); }
});
$("openInviteDialog").addEventListener("click", () => { $("inviteError").hidden = true; $("newInviteCode").value = ""; $("inviteDialog").showModal(); });
$("inviteCancel").addEventListener("click", () => $("inviteDialog").close());
$("inviteDialog").addEventListener("close", () => { $("newInviteCode").value = ""; });
$("inviteDialog").addEventListener("cancel", event => { if ($("inviteConfirm").disabled) event.preventDefault(); });
$("inviteConfirm").addEventListener("click", async () => {
  if ($("inviteConfirm").disabled) return;
  $("inviteConfirm").disabled = true; $("inviteCancel").disabled = true; $("inviteConfirm").setAttribute("aria-busy", "true");
  try {
    const code = $("newInviteCode").value.trim();
    if (code && (code.length < 8 || code.length > 128)) throw new Error("验证码长度应为 8–128 位，或留空自动生成。");
    await FC.request("admin/invite-codes", { method: "POST", body: { code } });
    $("inviteDialog").close(); await load(); status("验证码已更换，旧码已失效。请在上方查看并复制新验证码。");
  } catch (error) { $("inviteError").textContent = error.message; $("inviteError").hidden = false; }
  finally { $("inviteConfirm").disabled = false; $("inviteCancel").disabled = false; $("inviteConfirm").removeAttribute("aria-busy"); }
});
load();
