"use strict";
const apiPost = (action, payload) => FC.request(action, { method: "POST", body: payload });
const STORE = {
  _users: {}, _entries: [], _account: null, _online: false, registrationOpen: false,
  _sessionEpoch: 0, _dataRequest: 0, _revision: "", _version: 0,
  async load() {
    const request = ++this._dataRequest, epoch = this._sessionEpoch;
    let response;
    try { response = await FC.request("sync" + (this._revision ? "?revision=" + encodeURIComponent(this._revision) : "")); }
    catch (error) {
      if(request !== this._dataRequest || epoch !== this._sessionEpoch) return false;
      if(error.status!==404)throw error;
      // A client can reload before the running Node process is restarted during an upgrade.
      const session=await FC.bootstrap(), data=session.user&&!session.user.mustChangePassword?await FC.request("data"):null;
      response={...session,changed:!!data,revision:"",...(data||{})};
    }
    if (request !== this._dataRequest || epoch !== this._sessionEpoch) return false;
    const lostSession = !!this._account && !response.user;
    const previousAccount = JSON.stringify(this._account), previousOpen = this.registrationOpen, wasOnline = this._online;
    this._online = true; this._account = response.user; this.registrationOpen = response.registrationOpen;
    let changed = response.changed;
    if (!response.user || response.user.mustChangePassword) {
      changed = this._entries.length > 0 || Object.keys(this._users).length > 0;
      this._users = {}; this._entries = []; this._revision = "";
    } else if (response.changed) {
      this._users = response.users; this._entries = response.entries; this._revision = response.revision;
    }
    if (changed) this._version++;
    if (lostSession) window.dispatchEvent(new Event("fc-session-expired"));
    return changed || previousAccount !== JSON.stringify(this._account) || previousOpen !== this.registrationOpen || !wasOnline;
  },
  async refreshData() { return this.load(); },
  async refresh() { return this.load(); },
  getUsers() { return this._users; },
  getUser(qq) { return this._users[qq] || (this._account?.qq === qq ? this._account : null); },
  getEntries() { return this._entries; },
  getAccount() { return this._account; },
  accept(user) {
    this._sessionEpoch++; this._version++;
    if (this._account?.qq !== user.qq || user.mustChangePassword) this._revision = "";
    this._account = user; this._users[user.qq] = user;
  },
  setCopyCount(id, count) { const entry = this._entries.find(item => item.id === id); if (entry && entry.copyCount !== count) { entry.copyCount = count; this._dataRequest++; this._version++; } },
  clear() { this._sessionEpoch++; this._dataRequest++; this._version++; this._revision = ""; this._account = null; this._users = {}; this._entries = []; FC.clear(); },
};

function notify(message, error = false) {
  const el = document.getElementById("statusBanner");
  el.textContent = message; el.hidden = !message; el.classList.toggle("is-error", error);
}
async function busy(button, action, errorId) {
  if (button.disabled) return;
  button.disabled = true; button.setAttribute("aria-busy", "true");
  try { await action(); }
  catch (error) { if (errorId) showErr(errorId, error.message); else notify(error.message, true); }
  finally { button.disabled = false; button.removeAttribute("aria-busy"); }
}
async function afterLogin(user) {
  STORE.accept(user);
  closeLogin(); closeRegister();
  if (user.mustChangePassword) { STORE._entries = []; STORE._users = { [user.qq]: user }; renderAccount(); renderAll(); openPwd(); notify("站长已为你重置密码，请先设置自己的新密码。"); }
  else { await STORE.refreshData(); renderAccount(); renderAll(); notify(""); }
}
async function logout() {
  await apiPost("logout", {});
  STORE.clear(); document.querySelectorAll(".modal").forEach(el => { el.hidden = true; });
  renderAccount(); renderAll(); notify("已退出登录。");
}
function refreshViews() { renderAccount(); renderAll(); }

function avatarURL(qq, spec = 100) {
  return `https://q.qlogo.cn/headimg_dl?dst_uin=${encodeURIComponent(qq)}&spec=${spec}&img_type=jpg`;
}

const filters = { search: "", platform: "", game: "", server: "" };
let derivedCache;
function getDerived() {
  if (derivedCache?.version === STORE._version) return derivedCache;
  const sorted = sortEntries(STORE.getEntries()), games = new Map(), servers = new Map(), byQq = new Map(), byId = new Map(), search = new Map();
  for (const entry of sorted) {
    games.set(entry.game,(games.get(entry.game)||0)+1); servers.set(entry.server,(servers.get(entry.server)||0)+1); byId.set(entry.id,entry);
    if(!byQq.has(entry.qq))byQq.set(entry.qq,[]);byQq.get(entry.qq).push(entry);
    search.set(entry.id,[entry.qq,entry.nick,entry.game,entry.server,entry.code,entry.note,findGame(entry.game)?.alias].filter(Boolean).join(" ").toLowerCase());
  }
  derivedCache = { version:STORE._version,sorted,games,servers,byQq,byId,search,stats:[sorted.length,byQq.size,games.size,GAMES.length] };
  return derivedCache;
}

const $ = (id) => document.getElementById(id);
const accountArea = $("accountArea");
const statsBar = $("statsBar");
const gameTags = $("gameTags");
const serverTags = $("serverTags");
const entryList = $("entryList");
const emptyHint = $("emptyHint");

function Dropdown(root, onSelect) {
  let options = [], value = "";
  root.classList.add("dropdown");
  root.innerHTML = `<button type="button" class="dd-btn"></button><div class="dd-panel" hidden></div>`;
  const btn = root.querySelector(".dd-btn");
  const panel = root.querySelector(".dd-panel");
  function paint() {
    const cur = options.find((o) => o.value === value);
    btn.textContent = cur ? cur.label : "";
    panel.innerHTML = options.map((o) =>
      `<button type="button" class="dd-opt ${o.value === value ? "active" : ""}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</button>`
    ).join("");
    panel.querySelectorAll(".dd-opt").forEach((el) =>
      el.addEventListener("click", () => {
        value = el.dataset.value;
        paint();
        close();
        if (onSelect) onSelect(value);
      })
    );
  }
  btn.setAttribute("aria-label", root.getAttribute("aria-label") || (root.id === "platformFilter" ? "平台筛选" : "选择选项"));
  function open() { closeAllDropdowns(); root.classList.add("open"); panel.hidden = false; btn.setAttribute("aria-expanded", "true"); }
  function close() { root.classList.remove("open"); panel.hidden = true; btn.setAttribute("aria-expanded", "false"); }
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    root.classList.contains("open") ? close() : open();
  });
  panel.addEventListener("click", (ev) => ev.stopPropagation());
  return {
    set(opts, val) {
      options = opts || [];
      value = val != null ? val : (options[0] ? options[0].value : "");
      paint();
    },
    get() { return value; },
    setValue(v) { value = v; paint(); },
  };
}
function closeAllDropdowns() {
  document.querySelectorAll(".dropdown.open").forEach((d) => {
    d.classList.remove("open");
    const p = d.querySelector(".dd-panel");
    if (p) p.hidden = true;
    d.querySelector(".dd-btn")?.setAttribute("aria-expanded", "false");
  });
}
document.addEventListener("click", closeAllDropdowns);

const PLATFORM_OPTIONS = [
  { value: "", label: "全部平台" },
  { value: "mobile", label: "移动端" },
  { value: "pc", label: "PC端" },
  { value: "arcade", label: "街机" },
];
function gameOptions() {
  return GAMES.map((g) => ({ value: g.name, label: `${g.name}（${g.platforms.map((p) => PLATFORM_LABEL[p]).join("/")}）` }));
}
function serverOptions(gameName) {
  const g = findGame(gameName);
  return (g ? g.servers : []).map((s) => ({ value: s, label: s }));
}
function syncServers(gameName) {
  const opts = serverOptions(gameName);
  serverDD.set(opts, opts[0] ? opts[0].value : "");
}

const platformDD = Dropdown($("platformFilter"), (v) => { filters.platform = v; renderList(); });
const gameDD = Dropdown($("gameSelect"), (v) => { syncServers(v); });
const serverDD = Dropdown($("serverSelect"), null);
platformDD.set(PLATFORM_OPTIONS, "");

function showErr(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.hidden = false;
}

function renderAccount() {
  const acc = STORE.getAccount();
  const key = JSON.stringify([acc?.qq || "", acc?.role || "", !!acc?.mustChangePassword, STORE.registrationOpen]);
  if (accountArea._renderKey === key) {
    if (acc) LiveUI.text(accountArea.querySelector(".nick"), acc.nick || "未设置昵称");
    return;
  }
  accountArea._renderKey = key;
  if (!acc) {
    accountArea.innerHTML = '<button class="btn" id="loginBtn">登录</button>' + (STORE.registrationOpen ? '<button class="btn btn-primary" id="registerBtn">注册</button>' : '');
    $("loginBtn").addEventListener("click", openLogin);
    $("registerBtn")?.addEventListener("click", openRegister);
    return;
  }
  const isAdmin = acc.role === "admin";
  accountArea.innerHTML = `
    <div class="acc-info"><button class="account-profile" id="ownQq">${escapeHtml(acc.qq)} ${isAdmin ? '<span class="role-badge">站长</span>' : ""}</button><span class="nick">${escapeHtml(acc.nick || "未设置昵称")}</span></div>
    <button class="avatar-button" id="ownAvatar" aria-label="查看我的主页"><img class="avatar" src="${avatarURL(acc.qq, 100)}" alt="" width="44" height="44" /></button>
    ${isAdmin && !acc.mustChangePassword ? '<a class="btn" href="admin/">管理后台</a>' : ""}
    <button class="btn" id="changePwdBtn">修改密码</button><button class="btn" id="logoutBtn">退出</button>`;
  $("ownQq").addEventListener("click", () => openProfile(acc.qq));
  $("ownAvatar").addEventListener("click", () => openProfile(acc.qq));
  $("changePwdBtn").addEventListener("click", openPwd);
  $("logoutBtn").addEventListener("click", () => busy($("logoutBtn"), logout));
}

const modalStack = [];
function syncModalStack() {
  for(let index=modalStack.length-1;index>=0;index--)if(modalStack[index].hidden)modalStack.splice(index,1);
  modalStack.forEach((modal,index)=>{const z=String(50+index);if(modal.style.zIndex!==z)modal.style.zIndex=z;});
  LiveUI.toggle(document.body,"background-paused",modalStack.length > 0 || document.hidden);
  window.GoldenDragonBorder.setOverlay(modalStack.at(-1)||null);
}
function showModal(el) {
  if (el.hidden) el._returnFocus = document.activeElement;
  clearTimeout(el._hideT); el.classList.remove("closing"); el.hidden = false;
  const existing = modalStack.indexOf(el); if(existing!==-1)modalStack.splice(existing,1);modalStack.push(el);syncModalStack();
  const first = el.querySelector("input, button, [tabindex='0']"); first?.focus();
}
function closeModal(el) {
  if (!el || el.hidden || (el.id === "pwdModal" && STORE.getAccount()?.mustChangePassword)) return;
  el.querySelectorAll('input[type="password"]').forEach(input => { input.value = ""; });
  el.classList.add("closing"); clearTimeout(el._hideT);
  el._hideT = setTimeout(() => { el.hidden = true; el.classList.remove("closing"); syncModalStack(); el._returnFocus?.focus(); }, 170);
}
document.querySelectorAll(".modal").forEach((modal, index) => {
  modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true");
  const title = modal.querySelector("h2"); if (title) { title.id ||= "dialog-title-" + index; modal.setAttribute("aria-labelledby", title.id); }
  else modal.setAttribute("aria-label", "群友个人主页");
  modal.addEventListener("click", event => { if (event.target === modal) closeModal(modal); });
});
document.addEventListener("keydown", event => {
  const modal = modalStack.at(-1);
  if (!modal) return;
  if (event.key === "Escape") closeModal(modal);
  if (event.key !== "Tab") return;
  const targets = [...modal.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled]), a[href], [tabindex="0"]')].filter(el => el.getClientRects().length);
  const first = targets[0], last = targets.at(-1);
  if (!first) return;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

function openLogin() {
  $("loginQq").value = ""; $("loginPwd").value = "";
  $("loginError").hidden = true;
  showModal($("loginModal"));
  $("loginQq").focus();
}
function closeLogin() { closeModal($("loginModal")); }

function openRegister() {
  $("regQq").value = ""; $("regPwd").value = ""; $("regCode").value = "";
  $("regError").hidden = true;
  showModal($("registerModal"));
  $("regQq").focus();
}
function closeRegister() { closeModal($("registerModal")); }

$("loginCancel").addEventListener("click", closeLogin);
$("loginSubmit").addEventListener("click", () => busy($("loginSubmit"), async () => {
  const qq = $("loginQq").value.trim(), password = $("loginPwd").value;
  if (!/^\d{5,12}$/.test(qq)) throw new Error("请输入有效的 QQ 号（5–12 位数字）。");
  const result = await apiPost("login", { qq, password });
  await afterLogin(result.user);
}, "loginError"));
$("regCancel").addEventListener("click", closeRegister);
$("regSubmit").addEventListener("click", () => busy($("regSubmit"), async () => {
  const qq = $("regQq").value.trim(), password = $("regPwd").value, code = $("regCode").value;
  if (!/^\d{5,12}$/.test(qq)) throw new Error("请输入有效的 QQ 号（5–12 位数字）。");
  if (password.length < 8 || password.length > 128) throw new Error("密码长度应为 8–128 位。");
  const result = await apiPost("register", { qq, password, code });
  await afterLogin(result.user); notify("注册成功，欢迎加入！");
}, "regError"));
async function applyNick(newNick) {
  const result = await FC.request("me/nick", { method: "PATCH", body: { nick: newNick } });
  STORE.accept(result.user); await STORE.refreshData(); refreshViews(); notify("昵称已保存。");
}

function openPwd() {
  $("pwdOld").value = ""; $("pwdNew").value = ""; $("pwdNew2").value = "";
  $("pwdError").hidden = true;
  const temporary = STORE.getAccount()?.mustChangePassword;
  $("pwdCancel").hidden = !!temporary; $("pwdLogout").hidden = !temporary;
  $("pwdHint").textContent = temporary ? "当前密码请填写站长发给你的临时密码。完成修改后才能查看群友信息。" : "修改后，其他设备的登录状态将失效。";
  showModal($("pwdModal")); $("pwdOld").focus();
}
function closePwd() { closeModal($("pwdModal")); }
$("pwdCancel").addEventListener("click", closePwd);
$("pwdLogout").addEventListener("click", () => busy($("pwdLogout"), logout));
$("pwdSubmit").addEventListener("click", () => busy($("pwdSubmit"), async () => {
  const oldPassword = $("pwdOld").value, newPassword = $("pwdNew").value;
  if (newPassword.length < 8 || newPassword.length > 128) throw new Error("新密码长度应为 8–128 位。");
  if (newPassword !== $("pwdNew2").value) throw new Error("两次输入的新密码不一致。");
  const result = await apiPost("password", { oldPassword, newPassword });
  STORE.accept(result.user); closePwd(); await STORE.refreshData(); refreshViews(); notify("密码已修改，其他设备需要重新登录。");
}, "pwdError"));

let pendingDelId = null;
function openDel(id) {
  if (!STORE.getAccount()) { openLogin(); return; }
  pendingDelId = id;
  $("delPwd").value = "";
  $("delError").hidden = true;
  showModal($("delModal"));
  $("delPwd").focus();
}
function closeDel() { closeModal($("delModal")); pendingDelId = null; }
$("delCancel").addEventListener("click", closeDel);
$("delSubmit").addEventListener("click", () => busy($("delSubmit"), async () => {
  const id = pendingDelId;
  await FC.request("entries/" + encodeURIComponent(id), { method: "DELETE", body: { password: $("delPwd").value } });
  closeDel(); await STORE.refreshData(); refreshViews(); notify("好友码已删除。");
}, "delError"));

let editingEntryId = null;

function openAdd() {
  const acc = STORE.getAccount();
  if (!acc) { alert("请先登录或注册后再添加好友码。"); openLogin(); return; }
  editingEntryId = null;
  const opts = gameOptions();
  gameDD.set(opts, opts[0] ? opts[0].value : "");
  syncServers(opts[0] ? opts[0].value : "");
  $("addTitle").textContent = "添加好友码";
  $("codeInput").value = "";
  $("noteInput").value = "";
  $("addError").hidden = true;
  showModal($("addModal"));
  $("codeInput").focus();
}

// 编辑好友码：复用「添加」弹窗，字段完全一样，只有标题和提交行为不同
function openEdit(id) {
  const acc = STORE.getAccount();
  if (!acc) { openLogin(); return; }
  const entry = getDerived().byId.get(id);
  if (!entry) return;
  if (acc.qq !== entry.qq && acc.role !== "admin") { alert("只能编辑自己的好友码。"); return; }
  editingEntryId = id;
  const opts = gameOptions();
  gameDD.set(opts, entry.game);
  syncServers(entry.game);
  serverDD.setValue(entry.server);
  $("addTitle").textContent = "编辑好友码";
  $("codeInput").value = entry.code;
  $("noteInput").value = entry.note || "";
  $("addError").hidden = true;
  showModal($("addModal"));
  $("codeInput").focus();
}

function closeAdd() { closeModal($("addModal")); editingEntryId = null; }

$("addCancel").addEventListener("click", closeAdd);
$("addSubmit").addEventListener("click", () => busy($("addSubmit"), async () => {
  const fields = { game: gameDD.get(), server: serverDD.get(), code: $("codeInput").value.trim(), note: $("noteInput").value.trim() };
  if (!fields.code) throw new Error("请填写好友码 / 好友ID。");
  const id = editingEntryId;
  await FC.request(id ? "entries/" + encodeURIComponent(id) : "entries", { method: id ? "PATCH" : "POST", body: fields });
  closeAdd(); await STORE.refreshData(); refreshViews(); notify(id ? "好友码已更新。" : "好友码已添加。");
}, "addError"));

function renderTagClouds() {
  const derived = getDerived(), key = JSON.stringify([derived.version,filters.game,filters.server]);
  if (gameTags._renderVersion === key) return; gameTags._renderVersion = key;
  const gameCounts = derived.games, serverCounts = derived.servers;
  function paint(root, values, attr, selected, counts) {
    if (!root.children.length) for (const value of values) {
      const chip = document.createElement("button"); chip.type = "button"; chip.className = "chip"; chip.setAttribute(attr, value);
      chip.append(document.createTextNode(value));
      const count = document.createElement("b"); count.className = "chip-count zero"; count.textContent = "0"; chip.append(count);
      chip.addEventListener("click", () => {
        const field = attr === "data-game" ? "game" : "server";
        filters[field] = filters[field] === value ? "" : value; renderAll();
      });
      root.append(chip);
    }
    for (const chip of root.children) {
      const value = chip.getAttribute(attr), count = counts.get(value) || 0;
      LiveUI.toggle(chip, "active", selected === value);
      LiveUI.attribute(chip, "aria-pressed", selected === value);
      const badge = chip.querySelector("b"); LiveUI.text(badge, count); LiveUI.toggle(badge, "zero", count === 0);
    }
  }
  paint(gameTags, GAMES.map(game => game.name), "data-game", filters.game, gameCounts);
  paint(serverTags, allServers(), "data-server", filters.server, serverCounts);
}
function renderStats(list) {
  const derived = getDerived(); if (statsBar._renderVersion === derived.version) return; statsBar._renderVersion = derived.version;
  if (!statsBar.children.length) statsBar.innerHTML = ["好友码记录", "群友人数", "覆盖音游", "支持音游总数"].map(label => `<div class="stat"><div class="num">0</div><div class="lbl">${label}</div></div>`).join("");
  const values = derived.stats;
  statsBar.querySelectorAll(".num").forEach((node, index) => LiveUI.text(node, values[index]));
}

function matchFilters(e) {
  const g = findGame(e.game);
  if (filters.platform && (!g || !g.platforms.includes(filters.platform))) return false;
  if (filters.game && e.game !== filters.game) return false;
  if (filters.server && e.server !== filters.server) return false;
  if (filters.search) {
    const q = filters.search.toLowerCase();
    const hay = getDerived().search.get(e.id) || "";
    if (!hay.includes(q)) return false;
  }
  return true;
}

function cardHtml(e, profile = false) {
  const g = findGame(e.game);
  const acc = STORE.getAccount();
  const isMine = acc && acc.qq === e.qq;
  const isAdmin = acc && acc.role === "admin";
  const canDelete = isMine || isAdmin;
  const canEdit = isMine || isAdmin;
  const owner = STORE.getUser(e.qq);
  const isOwnerCard = owner?.role === "admin";
  const cnt = Number.isSafeInteger(e.copyCount) && e.copyCount >= 0 ? e.copyCount : 0;
  const medals = [`<span class="medal game">${escapeHtml(e.game)}</span>`];
  medals.push(`<span class="medal server">${escapeHtml(e.server)}</span>`);
  if (g) g.platforms.forEach((p) => medals.push(`<span class="medal platform">${PLATFORM_LABEL[p]}</span>`));
  return `
  <div class="card${isOwnerCard ? " card-owner" : ""}${profile ? " card-profile" : ""}" data-id="${escapeHtml(e.id)}">
    ${isOwnerCard ? '<canvas class="dragon-border" aria-hidden="true"></canvas>' : ""}
    ${profile ? "" : `<div class="card-main">
      <img class="avatar" src="${avatarURL(e.qq, 100)}" alt="头像" loading="lazy" decoding="async" width="44" height="44"
           data-qq="${escapeHtml(e.qq)}" />
      <div class="who">
        <div class="qq" data-qq="${escapeHtml(e.qq)}">${escapeHtml(e.qq)}</div>
        <div class="nick">${escapeHtml(e.nick || "")}</div>
      </div>
    </div>`}
    <div class="card-tags">${medals.join("")}</div>
    <div class="card-code">
      <span class="code-val">${escapeHtml(e.code)}</span>
      <button type="button" class="copy" data-id="${escapeHtml(e.id)}">复制</button>
    </div>
    <div class="card-foot">
      ${e.note ? `<span class="note">${escapeHtml(e.note)}</span>` : ""}
      <span class="copy-count" title="被复制次数">已复制 <b>${cnt}</b> 次</span>
      ${canEdit || canDelete ? `<div class="card-actions">
        ${canEdit ? `<button type="button" class="edit" data-edit="${escapeHtml(e.id)}" title="${isAdmin && !isMine ? "站长编辑" : "编辑"}">编辑</button>` : ""}
        ${canDelete ? `<button type="button" class="del" data-del="${escapeHtml(e.id)}" aria-label="删除好友码" title="${isAdmin && !isMine ? "站长删除" : "删除"}">删除</button>` : ""}
      </div>` : ""}
    </div>
  </div>`;
}

const cardModels = new WeakMap();
function cardModel(entry, profile = false) {
  const account = STORE.getAccount();
  return { ...entry, nick: profile ? "" : (entry.nick || ""), note: entry.note || "", copyCount: Number.isSafeInteger(entry.copyCount) && entry.copyCount >= 0 ? entry.copyCount : 0,
    owner: STORE.getUser(entry.qq)?.role === "admin", editable: !!account && (account.qq === entry.qq || account.role === "admin"), adminEdit: !!account && account.role === "admin" && account.qq !== entry.qq };
}
function rememberCard(node, model) { cardModels.set(node, { model, signature: JSON.stringify(model) }); }
function createCard(entry, profile = false) {
  const template = document.createElement("template"); template.innerHTML = cardHtml(entry, profile).trim();
  const node = template.content.firstElementChild;
  for (const target of node.querySelectorAll(".qq, .card-main .avatar")) { target.tabIndex = 0; target.setAttribute("role", "button"); target.setAttribute("aria-label", "查看群友主页"); }
  rememberCard(node, cardModel(entry, profile)); return node;
}
function patchCard(node, entry) {
  const profile = node.classList.contains("card-profile");
  const next = cardModel(entry, profile), previous = cardModels.get(node);
  if (previous?.signature === JSON.stringify(next)) return false;
  const old = previous?.model || {};
  LiveUI.text(node.querySelector(".nick"), next.nick);
  LiveUI.text(node.querySelector(".code-val"), next.code);
  LiveUI.text(node.querySelector(".copy-count b"), next.copyCount);
  if (!profile && old.qq !== next.qq) {
    const avatar = node.querySelector(".card-main .avatar"); avatar.src = avatarURL(next.qq); avatar.dataset.qq = next.qq;
    const qq = node.querySelector(".qq"); qq.dataset.qq = next.qq; LiveUI.text(qq, next.qq);
  }
  if (old.game !== next.game || old.server !== next.server) {
    const game = findGame(next.game);
    node.querySelector(".card-tags").innerHTML = `<span class="medal game">${escapeHtml(next.game)}</span><span class="medal server">${escapeHtml(next.server)}</span>` + (game ? game.platforms.map(platform => `<span class="medal platform">${escapeHtml(PLATFORM_LABEL[platform])}</span>`).join("") : "");
    LiveUI.highlight(node.querySelector(".card-tags"));
  }
  let note = node.querySelector(".card-foot > .note");
  if (!next.note) LiveUI.removeField(note);
  else { if (!note) { note = document.createElement("span"); note.className = "note"; node.querySelector(".card-foot").prepend(note); } LiveUI.text(note, next.note); }
  if (old.owner !== next.owner) {
    LiveUI.toggle(node, "card-owner", next.owner);
    if (next.owner && !node.querySelector(".dragon-border")) { const canvas = document.createElement("canvas"); canvas.className = "dragon-border"; canvas.setAttribute("aria-hidden", "true"); node.prepend(canvas); }
    if (!next.owner) node.querySelector(".dragon-border")?.remove();
  }
  if (old.editable !== next.editable || old.adminEdit !== next.adminEdit) {
    node.querySelector(".card-actions")?.remove();
    if (next.editable) {
      const actions = document.createElement("div"); actions.className = "card-actions";
      actions.innerHTML = `<button type="button" class="edit" data-edit="${escapeHtml(next.id)}" title="${next.adminEdit ? "站长编辑" : "编辑"}">编辑</button><button type="button" class="del" data-del="${escapeHtml(next.id)}" aria-label="删除好友码" title="${next.adminEdit ? "站长删除" : "删除"}">删除</button>`;
      node.querySelector(".card-foot").append(actions);
    }
  }
  rememberCard(node, next); return true;
}
function bindCardEvents(root) {
  if (root._eventsBound) return; root._eventsBound = true;
  root.addEventListener("pointerenter", event => {
    if (event.pointerType !== "mouse" || !event.target.matches?.(".card") || event.target.classList.contains("live-leaving")) return;
    root._hoveredCardId = event.target.dataset.id;
  }, true);
  root.addEventListener("pointerleave", event => {
    if (event.pointerType !== "mouse" || !event.target.matches?.(".card")) return;
    const id = event.target.dataset.id;
    if (root._hoveredCardId === id) root._hoveredCardId = null;
    if (root._deferredSortForId !== id) return;
    requestAnimationFrame(() => {
      if (root._deferredSortForId === id && root._hoveredCardId !== id) {
        root._deferredSortForId = null; renderAll();
      }
    });
  }, true);
  root.addEventListener("keydown", event => {
    const target = event.target.closest(".qq, .card-main .avatar");
    if (target && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); target.click(); }
  });
  root.addEventListener("click", event => {
    const card = event.target.closest(".card"); if (!card || card.classList.contains("live-leaving")) return;
    const copy = event.target.closest(".copy");
    if (copy) {
      event.stopPropagation();
      busy(copy, async () => {
        const entry = getDerived().byId.get(copy.dataset.id); if (!entry) return;
        await FC.copy(entry.code); copy.classList.add("copied"); copy.textContent = "已复制";
        try { const result = await apiPost("copy", { id: entry.id }); STORE.setCopyCount(entry.id, result.copyCount); renderAll(); }
        catch (error) { notify("好友码已复制，但复制次数未更新：" + error.message, true); }
        setTimeout(() => { copy.classList.remove("copied"); copy.textContent = "复制"; }, 1200);
      });
      return;
    }
    const remove = event.target.closest(".del"); if (remove) { event.stopPropagation(); openDel(remove.dataset.del); return; }
    const edit = event.target.closest(".edit"); if (edit) { event.stopPropagation(); openEdit(edit.dataset.edit); return; }
    const profile = event.target.closest(".qq, .card-main .avatar"); if (profile) openProfile(profile.dataset.qq);
  });
}
function sortEntries(entries) {
  return entries.slice().sort((a, b) => (Number(b.copyCount) || 0) - (Number(a.copyCount) || 0) || (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0) || String(a.id).localeCompare(String(b.id)));
}
function orderWhileHovered(root, entries) {
  const cards = [...root.children].filter(node => node.classList.contains("card") && !node.classList.contains("live-leaving"));
  const byId = new Map(entries.map(entry => [String(entry.id), entry]));
  const hovered = cards.find(card => card.dataset.id === root._hoveredCardId);
  if (!hovered?.matches(":hover")) root._hoveredCardId = null;
  if (root._deferredSortForId && (root._hoveredCardId !== root._deferredSortForId || !byId.has(root._deferredSortForId))) root._deferredSortForId = null;
  if (!root._deferredSortForId && hovered && root._hoveredCardId && byId.has(root._hoveredCardId)) {
    const previous = cardModels.get(hovered)?.model;
    const incoming = byId.get(root._hoveredCardId);
    const oldIndex = cards.indexOf(hovered), nextIndex = entries.indexOf(incoming);
    if (previous && incoming.copyCount > previous.copyCount && nextIndex < oldIndex) root._deferredSortForId = root._hoveredCardId;
  }
  if (!root._deferredSortForId) return entries;
  // Keep existing cards in place while the active copy target is under the mouse.
  // New records and removals still update immediately, independently of the deferred ranking.
  const held = cards.filter(card => byId.has(card.dataset.id)).map(card => byId.get(card.dataset.id));
  const included = new Set(held.map(entry => String(entry.id)));
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]; if (included.has(String(entry.id))) continue;
    const successor = entries.slice(index + 1).find(item => included.has(String(item.id)));
    const position = successor ? held.findIndex(item => item.id === successor.id) : held.length;
    held.splice(position, 0, entry); included.add(String(entry.id));
  }
  return held;
}
function renderCards(root, entries, animate = true) {
  bindCardEvents(root);
  entries = orderWhileHovered(root, entries);
  const profile = root.classList.contains("profile-grid");
  LiveUI.reconcile(root, entries, { create: entry => createCard(entry, profile), patch: patchCard, mounted: target => window.GoldenDragonBorder.mount(target), animate, version: JSON.stringify(entries.map(entry => cardModel(entry, profile))) });
}

function renderList() {
  if (queuedListFrame !== null) { cancelAnimationFrame(queuedListFrame); queuedListFrame = null; }
  const list = getDerived().sorted.filter(matchFilters), account = STORE.getAccount();
  renderCards(entryList, list, !!account && !account.mustChangePassword);
  const hidden = list.length !== 0; if (emptyHint.hidden !== hidden) emptyHint.hidden = hidden;
  LiveUI.text(emptyHint, !account ? "请先登录或注册，群友信息仅对已登录成员开放。" : account.mustChangePassword ? "请先修改临时密码。" : "暂无匹配的好友码，换个筛选条件或先添加一条吧～", false);
}
function renderProfile(qq) {
  const body = $("profileBody"), user = STORE.getUser(qq), account = STORE.getAccount();
  const isSelf = account?.qq === qq, nick = user?.nick || "", key = JSON.stringify([qq, isSelf]);
  if (body._profileKey !== key) {
    body._profileKey = key; body.dataset.qq = qq;
    body.innerHTML = `<div class="profile-head"><img class="avatar-lg" src="${avatarURL(qq, 640)}" alt="头像" /><div class="profile-meta"><div class="profile-qq"><span class="profile-id">${escapeHtml(qq)}</span><span class="role-badge" hidden>站长</span></div>
      ${isSelf ? '<div class="profile-nick-edit"><input type="text" id="nickEdit" placeholder="设置显示昵称" maxlength="20" /><button class="btn btn-primary" id="nickSave">保存</button></div>' : '<div class="profile-nick"></div>'}
      </div></div><div class="profile-codes"><div class="tag-label">好友码（<span class="profile-entry-count">0</span>）</div><div class="profile-grid"></div><p class="empty-hint profile-empty" hidden>该群友还没有添加好友码。</p></div>`;
    if (isSelf) {
      $("nickEdit").value = nick; $("nickEdit").dataset.savedNick = nick;
      $("nickSave").addEventListener("click", () => busy($("nickSave"), () => applyNick($("nickEdit").value.trim())));
    }
  }
  const badge = body.querySelector(".role-badge"), owner = user?.role === "admin";
  if (badge.hidden === owner) badge.hidden = !owner;
  if (isSelf) {
    const input = $("nickEdit"), saved = input.dataset.savedNick;
    if (input.value === saved || input.value === nick) { if (input.value !== nick) input.value = nick; if (saved !== nick) input.dataset.savedNick = nick; }
  } else {
    const label = body.querySelector(".profile-nick"); LiveUI.text(label, nick || "未设置昵称"); LiveUI.toggle(label, "dim", !nick);
  }
  const entries = getDerived().byQq.get(qq) || [];
  LiveUI.text(body.querySelector(".profile-entry-count"), entries.length);
  const empty = body.querySelector(".profile-empty"); if (empty.hidden !== !!entries.length) empty.hidden = !!entries.length;
  renderCards(body.querySelector(".profile-grid"), entries, !$("profileModal").hidden);
}
function openProfile(qq) {
  const account = STORE.getAccount();
  if (!account) { openLogin(); return; } if (account.mustChangePassword) { openPwd(); return; }
  renderProfile(qq); if ($("profileModal").hidden) showModal($("profileModal"));
}

function closeProfile() { closeModal($("profileModal")); }
$("profileClose").addEventListener("click", closeProfile);



function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

let queuedListFrame = null;
function scheduleListRender() {
  if (queuedListFrame !== null) return;
  queuedListFrame = requestAnimationFrame(() => { queuedListFrame = null; renderList(); });
}
$("addBtn").addEventListener("click", openAdd);
const searchInput = $("searchInput");
searchInput.value = "";
const unlockSearch = () => searchInput.removeAttribute("readonly");
searchInput.addEventListener("focus", unlockSearch, { once: true });
searchInput.addEventListener("pointerdown", unlockSearch, { once: true });
searchInput.addEventListener("input", (e) => {
  const value = e.target.value.trim(), clear = $("searchClear");
  if (clear.hidden !== !value) clear.hidden = !value;
  if (!e.isComposing) { filters.search = value; scheduleListRender(); }
});
searchInput.addEventListener("compositionend", () => { filters.search = searchInput.value.trim(); scheduleListRender(); });
$("searchClear").addEventListener("click", () => {
  searchInput.value = "";
  filters.search = "";
  $("searchClear").hidden = true;
  renderList();
  searchInput.focus();
});
$("resetBtn").addEventListener("click", () => {
  filters.search = ""; filters.platform = ""; filters.game = ""; filters.server = "";
  $("searchInput").value = "";
  platformDD.setValue("");
  renderAll();
});

function renderAll() {
  renderTagClouds();
  renderStats(STORE.getEntries());
  renderList();
  const account = STORE.getAccount();
  if (!account || account.mustChangePassword) {
    $("profileModal").hidden = true;
    if ($("profileBody").children.length) { $("profileBody").replaceChildren(); $("profileBody")._profileKey = null; delete $("profileBody").dataset.qq; window.GoldenDragonBorder.mount(entryList); }
  } else if (!$("profileModal").hidden) renderProfile($("profileBody").dataset.qq);
  syncModalStack();
}

// 后台静默刷新：按记录 ID 增量更新；未改变的节点、焦点和动画保持原样。
const AUTO_REFRESH_MS = 30000;
let refreshing = false;
async function autoRefresh() {
  if (refreshing || document.hidden) return;
  refreshing = true;
  try {
    if (await STORE.refresh()) { renderAccount(); renderAll(); }
    if (STORE.getAccount()?.mustChangePassword && $("pwdModal").hidden) openPwd();
  } catch (error) { notify(error.message, true); } finally {
    refreshing = false;
  }
}
function startAutoRefresh() {
  setInterval(autoRefresh, AUTO_REFRESH_MS);
  // 从后台切回页面时立刻补一次，避免看到过期数据
  document.addEventListener("visibilitychange", () => { syncModalStack(); if (!document.hidden) autoRefresh(); });
}

function buildBars() {
  const wrap = document.querySelector(".bg-bars");
  if (!wrap) return;
  const n = 48;
  for (let i = 0; i < n; i++) {
    const b = document.createElement("span");
    // 周期、相位、起伏幅度全部随机：每条柱子都不同步，避免出现规律的"波浪"感
    const dur = 0.9 + Math.random() * 1.4;          // 0.9 ~ 2.3s
    b.style.animationDuration = dur.toFixed(2) + "s";
    b.style.animationDelay = (-Math.random() * dur * 2).toFixed(2) + "s";  // 负延时＝随机起始相位
    b.style.setProperty("--floor", (0.06 + Math.random() * 0.14).toFixed(2));
    b.style.setProperty("--peak", (0.42 + Math.random() * 0.52).toFixed(2));
    wrap.appendChild(b);
  }
}

window.addEventListener("fc-session-expired", () => {
  STORE.clear(); document.querySelectorAll(".modal").forEach(el => { el.hidden = true; });
  renderAccount(); renderAll(); notify("登录已过期或密码已重置，请重新登录。", true);
});
for (const [inputId, buttonId] of [["loginPwd", "loginSubmit"], ["regCode", "regSubmit"], ["pwdNew2", "pwdSubmit"], ["delPwd", "delSubmit"]]) {
  $(inputId).addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); $(buttonId).click(); } });
}
async function init() {
  // Remove legacy credentials/data caches; group information is no longer persisted in this browser.
  try { for (const key of ["fc_u", "fc_e", "fc_s", "fc_v", "fc_inited", "fc_seeded"]) localStorage.removeItem(key); } catch { /* Storage can be disabled. */ }
  buildBars();
  try { await STORE.load(); } catch (error) { notify(error.message, true); }
  renderAccount(); renderAll(); startAutoRefresh();
  if (STORE.getAccount()?.mustChangePassword) openPwd();
}

init();
