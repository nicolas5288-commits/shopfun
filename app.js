/* ============ 購物趣 SPA · V2（Supabase：登入／按讚／清單／投稿／檢疫區）============ */

const COUNTRIES = {
  jp: { name: "日本", flag: "🇯🇵", tagline: "藥妝、零食、生活小物的天堂，唐吉訶德一逛就是三小時", currency: "日圓 JPY", tint: "#E3D3D8" },
  kr: { name: "韓國", flag: "🇰🇷", tagline: "Olive Young 美妝挖寶＋便利商店零食，行李箱永遠不夠裝", currency: "韓元 KRW", tint: "#D3DBE0" },
  th: { name: "泰國", flag: "🇹🇭", tagline: "Big C 零食掃貨＋草本藥品保健，便宜到懷疑人生", currency: "泰銖 THB", tint: "#D5DDD3" },
};
const SEED_FILE = { jp: "data/seed_jp.json", kr: "data/seed_kr.json", th: "data/seed_th.json" };

const CATEGORIES = { all: "全部", snacks: "零食", beauty: "美妝藥妝", daily: "生活小物", health: "藥品保健", souvenir: "伴手禮" };
const SORTS = { hot: "🔥 熱門", save: "省錢星級", rank: "必買指數" };
const PROMOTE_AT = 3; // 檢疫區轉正門檻（同步：DB promote_product 觸發器也要 >= 這個數）

// 推薦等級（旅遊里程風）；貢獻分 = 上榜商品×20 + 獲得讚×1
const LEVELS = [
  { min: 400, emoji: "👑", name: "出國購物趣傳說" },
  { min: 150, emoji: "🗺️", name: "環球導購官" },
  { min: 60, emoji: "🛫", name: "免稅店常客" },
  { min: 20, emoji: "🧳", name: "行李超重犯" },
  { min: 1, emoji: "🛒", name: "掃貨見習生" },
  { min: 0, emoji: "", name: "背包新客" },
];
function levelOf(score) { return LEVELS.find((l) => score >= l.min) || LEVELS[LEVELS.length - 1]; }
function nextLevel(score) { const above = LEVELS.filter((l) => l.min > score); return above.length ? above[above.length - 1] : null; }
// 依已載入的 products 算某人的貢獻分（獲讚×1 + 上榜×20 + 補圖通過×15）
const IMG_POINTS = 15;
function scoreOf(userId) {
  if (!userId) return { score: 0, likes: 0, ranked: 0, imgs: 0 };
  let likes = 0, ranked = 0;
  state.byId.forEach((p) => {
    if (p.submitted_by === userId) {
      likes += p.like_count || 0;
      if (p.status === "ranked") ranked += 1;
    }
  });
  const imgs = state.imgCountById.get(userId) || 0;
  return { score: likes + ranked * 20 + imgs * IMG_POINTS, likes, ranked, imgs };
}

const cfg = window.SHOPFUN_CONFIG || {};
const supa = (window.supabase && cfg.SUPABASE_URL)
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
      auth: { detectSessionInUrl: true, flowType: "implicit", persistSession: true, autoRefreshToken: true },
    })
  : null;

const state = {
  products: {},   // country -> array
  byId: new Map(),
  loaded: false,
  source: "seed",
  cat: "all",
  sort: "hot",
  user: null,
  liked: new Set(),
  wishlist: new Map(), // product_id -> bought(bool)
  profile: null,       // {nickname, avatar_emoji, avatar_bg}
  unread: 0,           // 未讀通知數
  nickById: new Map(), // user_id -> nickname（顯示「由 X 推薦」）
  imgCountById: new Map(), // user_id -> 通過的補圖數（算貢獻分）
};

const $app = document.getElementById("app");
const $nav = document.getElementById("topnav");
const $right = document.getElementById("topbar-right");

/* ---------- 小工具 ---------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function stars(n) { return `★`.repeat(n) + `<span class="dim">${"☆".repeat(5 - n)}</span>`; }
function mapsUrl(q) { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`; }
function isAdmin() { return state.user && state.user.email === cfg.ADMIN_EMAIL; }

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function hotness(p) {
  const likes = p.like_count || 0;
  const ageDays = p.created_at ? (Date.now() - new Date(p.created_at)) / 86400000 : 30;
  return likes / Math.pow(ageDays + 2, 1.2);
}

/* ---------- 資料載入 ---------- */
async function loadData() {
  if (state.loaded) return;
  let ok = false;
  if (supa) {
    try {
      const { data, error } = await supa.from("product_stats").select("*");
      if (error) throw error;
      if (data && data.length) {
        for (const c of Object.keys(COUNTRIES)) state.products[c] = [];
        data.forEach((p) => { if (state.products[p.country]) state.products[p.country].push(p); });
        state.source = "supabase";
        ok = true;
      }
    } catch (e) { console.warn("Supabase 讀取失敗，改用種子資料：", e.message); }
  }
  if (!ok) await loadSeed();
  state.byId.clear();
  Object.values(state.products).flat().forEach((p) => state.byId.set(p.id, p));
  // 投稿者暱稱（顯示「由 X 推薦」）＋補圖通過數（算分）；表不存在就略過
  if (supa && ok) {
    const [profR, imgR] = await Promise.allSettled([
      supa.from("profiles").select("user_id,nickname"),
      supa.from("image_submissions").select("user_id").eq("status", "approved"),
    ]);
    state.nickById = new Map();
    if (profR.status === "fulfilled") (profR.value.data || []).forEach((pr) => { if (pr.nickname) state.nickById.set(pr.user_id, pr.nickname); });
    state.imgCountById = new Map();
    if (imgR.status === "fulfilled") (imgR.value.data || []).forEach((r) => state.imgCountById.set(r.user_id, (state.imgCountById.get(r.user_id) || 0) + 1));
  }
  state.loaded = true;
}
async function loadSeed() {
  const entries = Object.entries(SEED_FILE);
  const res = await Promise.allSettled(entries.map(([, f]) => fetch(f).then((r) => { if (!r.ok) throw 0; return r.json(); })));
  entries.forEach(([c], i) => {
    const arr = res[i].status === "fulfilled" ? res[i].value : [];
    state.products[c] = arr.map((p) => ({ ...p, like_count: 0, status: "ranked", source: "seed", created_at: null }));
  });
  state.source = "seed";
}

/* ---------- 帳號 ---------- */
async function refreshUser() {
  if (!supa) return;
  const { data } = await supa.auth.getSession();
  state.user = data.session ? data.session.user : null;
  await loadUserState();
}
async function loadUserState() {
  state.liked = new Set();
  state.wishlist = new Map();
  state.profile = null;
  state.unread = 0;
  if (!supa || !state.user) return;
  const uid = state.user.id;
  const [likesR, wishR, profR, unreadR] = await Promise.allSettled([
    supa.from("likes").select("product_id").eq("user_id", uid),
    supa.from("wishlist").select("product_id,bought").eq("user_id", uid),
    supa.from("profiles").select("nickname,avatar_emoji,avatar_bg").eq("user_id", uid).maybeSingle(),
    supa.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("read", false),
  ]);
  if (likesR.status === "fulfilled") (likesR.value.data || []).forEach((l) => state.liked.add(l.product_id));
  if (wishR.status === "fulfilled") (wishR.value.data || []).forEach((w) => state.wishlist.set(w.product_id, w.bought));
  if (profR.status === "fulfilled" && profR.value.data) state.profile = profR.value.data;
  if (unreadR.status === "fulfilled" && typeof unreadR.value.count === "number") state.unread = unreadR.value.count;
}
async function login() {
  if (!supa) return toast("登入功能尚未設定");
  sessionStorage.setItem("returnHash", location.hash || "#/");
  await supa.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
}
async function logout() {
  await supa.auth.signOut();
  state.user = null; state.liked = new Set(); state.wishlist = new Map();
  state.profile = null; state.unread = 0;
  renderRight(); location.hash = "#/"; route();
  toast("已登出");
}
function requireLogin() { toast("請先用 Google 登入 👇"); login(); }

function displayName() {
  return state.profile?.nickname || state.user?.user_metadata?.name || state.user?.email || "我";
}
function avatarHTML() {
  const u = state.user;
  if (state.profile?.avatar_emoji) {
    return `<span class="avatar-emoji" style="background:${esc(state.profile.avatar_bg || "#F3E2D8")}">${esc(state.profile.avatar_emoji)}</span>`;
  }
  if (u?.user_metadata?.avatar_url) return `<img src="${esc(u.user_metadata.avatar_url)}" alt="" referrerpolicy="no-referrer">`;
  return `<span class="avatar-fallback">${esc(displayName()[0] || "我")}</span>`;
}

/* ---------- 頂欄 ---------- */
function renderNav(active) {
  const countries = Object.entries(COUNTRIES)
    .map(([c, m]) => `<a href="#/country/${c}" class="${active === c ? "active" : ""}">${m.flag} ${m.name}</a>`)
    .join("");
  $nav.innerHTML = `${countries}<a href="#/hot" class="${active === "hot" ? "active" : ""}">🔥 熱門</a><button class="nav-search" id="navSearch" title="搜尋商品">🔍</button>`;
  document.getElementById("navSearch").onclick = showSearch;
}
function renderRight() {
  if (!supa) { $right.innerHTML = ""; return; }
  if (state.user) {
    const dot = state.unread > 0 ? `<span class="tb-dot"></span>` : "";
    const donateItem = cfg.DONATE_URL ? `<a href="${esc(cfg.DONATE_URL)}" target="_blank" rel="noopener" class="tb-mi">☕ 小額贊助</a>` : "";
    const sc = scoreOf(state.user.id); sc.lv = levelOf(sc.score);
    $right.innerHTML = `
      ${isAdmin() ? `<a href="#/admin" class="tb-link tb-admin" title="管理後台">⚙️ 管理</a>` : ""}
      <a href="#/list" class="tb-link" title="我的清單">🧳 清單</a>
      <a href="#/submit" class="tb-link tb-cta">＋ 推好物</a>
      <div class="tb-user" id="tbUser">${avatarHTML()}${dot}</div>
      <div class="tb-menu" id="tbMenu" hidden>
        <div class="tb-menu-name">${esc(displayName())}</div>
        <a href="#/profile" class="tb-score">${sc.lv.emoji || "🎒"} ${esc(sc.lv.name)} · 貢獻分 ${sc.score}</a>
        <div class="tb-mdiv"></div>
        <a href="#/profile" class="tb-mi">👤 個人設定</a>
        <a href="#/notifications" class="tb-mi">🔔 通知中心${state.unread > 0 ? ` <span class="tb-badge">${state.unread}</span>` : ""}</a>
        <a href="#/hot" class="tb-mi">🔥 近期熱門</a>
        <div class="tb-mdiv"></div>
        <button class="tb-mi" id="miGuide">❓ 使用說明</button>
        <button class="tb-mi" id="miInstall">📲 加到主畫面</button>
        ${cfg.COMMUNITY_URL ? `<a href="${esc(cfg.COMMUNITY_URL)}" target="_blank" rel="noopener" class="tb-mi">👥 使用者社群</a>` : ""}
        <a href="${esc(cfg.IG_URL || "#")}" target="_blank" rel="noopener" class="tb-mi">📩 聯繫我們</a>
        ${donateItem}
        <div class="tb-mdiv"></div>
        <button id="btnLogout" class="tb-mi">登出</button>
      </div>`;
    const menu = document.getElementById("tbMenu");
    document.getElementById("tbUser").onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    document.getElementById("btnLogout").onclick = logout;
    document.getElementById("miGuide").onclick = () => { menu.hidden = true; showGuideModal(); };
    document.getElementById("miInstall").onclick = () => { menu.hidden = true; showInstallModal(); };
    menu.querySelectorAll("a").forEach((a) => a.onclick = () => { menu.hidden = true; });
    document.addEventListener("click", () => { menu.hidden = true; }, { once: true });
  } else {
    $right.innerHTML = `<button class="tb-login" id="btnLogin">Google 登入</button>`;
    document.getElementById("btnLogin").onclick = login;
  }
}

/* ---------- 首頁 ---------- */
function renderHome() {
  renderNav(null);
  document.title = "出國購物趣｜出國必買好物指南";
  const cards = Object.entries(COUNTRIES).map(([c, m]) => {
    const count = (state.products[c] || []).filter((p) => p.status !== "new").length;
    return `<a class="country-card" href="#/country/${c}" style="--tint:${m.tint}">
      <div class="country-flag">${m.flag}</div>
      <h2>${m.name}</h2>
      <p class="country-tagline">${m.tagline}</p>
      <div class="country-meta"><span>${count ? `${count} 樣必買好物` : "整理中"}</span><span class="go">去逛逛 →</span></div>
    </a>`;
  }).join("");
  $app.innerHTML = `
    <section class="hero">
      <div class="hero-kicker">出國購物指南</div>
      <h1>出國不知道買什麼？<br>讓<em>購物趣</em>當你的行李清單</h1>
      <p>必買好物 × 省錢星級 × 一鍵導航到最近的店</p>
      ${state.user ? "" : `<button class="hero-cta" onclick="__login()">用 Google 登入，把好物按上榜</button>`}
    </section>
    <section class="home-hot" id="homeHot"></section>
    <section class="country-grid">${cards}</section>`;
  renderHomeHot();
  window.scrollTo(0, 0);
}

async function renderHomeHot() {
  const box = document.getElementById("homeHot");
  if (!box) return;
  if (!hotState.weekCount) await loadWeekCounts();
  if (!document.getElementById("homeHot")) return; // 期間可能已換頁
  const items = Object.values(state.products).flat().filter((p) => p.status === "ranked");
  let hot = items.map((p) => ({ p, n: hotState.weekCount.get(p.id) || 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).map((x) => x.p);
  if (hot.length < 6) {
    const extra = items.filter((p) => !hot.includes(p)).sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
    hot = hot.concat(extra);
  }
  hot = hot.slice(0, 6);
  if (!hot.length) { box.innerHTML = ""; return; }
  box.innerHTML = `
    <div class="home-hot-head"><h2>🔥 本週熱門</h2><a href="#/hot">看完整榜單 →</a></div>
    <div class="product-grid">${hot.map((p) => productCard(p, null, { showCountry: true })).join("")}</div>`;
  bindCardEvents(box);
}

/* ---------- 前台搜尋 ---------- */
function showSearch() {
  document.querySelector(".search-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay search-overlay";
  overlay.innerHTML = `
    <div class="search-box" onclick="event.stopPropagation()">
      <div class="search-head">
        <span class="search-ico">🔍</span>
        <input id="searchInput" class="search-input" placeholder="搜商品名：EVE、面膜、海苔…" autocomplete="off">
        <button class="search-close" id="searchClose">✕</button>
      </div>
      <div class="search-results" id="searchResults"></div>
    </div>`;
  document.body.appendChild(overlay);
  const input = document.getElementById("searchInput");
  const results = document.getElementById("searchResults");
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onEsc); };
  function onEsc(e) { if (e.key === "Escape") close(); }
  document.getElementById("searchClose").onclick = close;
  overlay.onclick = close;
  document.addEventListener("keydown", onEsc);
  const render = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.innerHTML = `<div class="search-hint">輸入商品名試試：EVE、面膜、海苔…</div>`; return; }
    const all = Object.values(state.products).flat().filter((p) => p.status === "ranked");
    const hits = all.filter((p) => [p.name_zh || "", p.name_local || "", ...(p.where || [])].join(" ").toLowerCase().includes(q)).slice(0, 30);
    if (!hits.length) {
      results.innerHTML = `<div class="search-hint">找不到「${esc(input.value.trim())}」😢<br><a href="#/submit" class="search-sub">要不要幫大家推薦這個好物？</a></div>`;
      results.querySelector(".search-sub").onclick = close;
      return;
    }
    results.innerHTML = `<div class="product-grid">${hits.map((p) => productCard(p, null, { showCountry: true })).join("")}</div>`;
    bindCardEvents(results);
  };
  input.oninput = render;
  render();
  setTimeout(() => input.focus(), 50);
}

/* ---------- 國家頁 ---------- */
function renderCountry(code) {
  const meta = COUNTRIES[code];
  if (!meta) return renderHome();
  renderNav(code);
  document.title = `${meta.name}必買好物｜出國購物趣`;
  const catTabs = Object.entries(CATEGORIES).map(([k, l]) => `<button class="cat-tab ${state.cat === k ? "active" : ""}" data-cat="${k}">${l}</button>`).join("");
  const sortOpts = Object.entries(SORTS).map(([k, l]) => `<option value="${k}" ${state.sort === k ? "selected" : ""}>${l}</option>`).join("");
  $app.innerHTML = `
    <section class="country-head">
      <span class="flag">${meta.flag}</span>
      <h1>${meta.name}必買好物</h1>
      <span class="sub">價格以${meta.currency}計，台幣為約略換算</span>
    </section>
    <div class="toolbar"><div class="toolbar-inner">
      <div class="cat-tabs">${catTabs}</div>
      <div class="toolbar-spacer"></div>
      <div class="sort-wrap">排序 <select class="sort-select" id="sortSel">${sortOpts}</select></div>
    </div></div>
    <section class="product-grid" id="grid"></section>
    <section id="quarantine"></section>`;
  $app.querySelectorAll(".cat-tab").forEach((btn) => btn.addEventListener("click", () => {
    state.cat = btn.dataset.cat;
    $app.querySelectorAll(".cat-tab").forEach((b) => b.classList.toggle("active", b === btn));
    renderGrid(code); renderQuarantine(code);
  }));
  document.getElementById("sortSel").addEventListener("change", (e) => { state.sort = e.target.value; renderGrid(code); });
  renderGrid(code); renderQuarantine(code);
  window.scrollTo(0, 0);
}

function sortItems(items) {
  const s = state.sort;
  if (s === "save") return items.sort((a, b) => b.save_stars - a.save_stars || hotness(b) - hotness(a));
  if (s === "rank") return items.sort((a, b) => (a.editor_rank ?? 999) - (b.editor_rank ?? 999) || hotness(b) - hotness(a));
  return items.sort((a, b) => hotness(b) - hotness(a) || (b.like_count || 0) - (a.like_count || 0));
}

function renderGrid(code) {
  const grid = document.getElementById("grid");
  let items = (state.products[code] || []).filter((p) => p.status === "ranked");
  if (state.cat !== "all") items = items.filter((p) => p.category === state.cat);
  items = sortItems([...items]);
  if (!items.length) {
    grid.innerHTML = `<div class="empty-state"><div class="big">🧳</div><p>這個分類還在整理中，先逛逛其他分類吧！</p></div>`;
    return;
  }
  grid.innerHTML = items.map((p, i) => productCard(p, i + 1)).join("");
  bindCardEvents(grid);
}

function renderQuarantine(code) {
  const box = document.getElementById("quarantine");
  if (!box) return;
  let items = (state.products[code] || []).filter((p) => p.status === "new");
  if (state.cat !== "all") items = items.filter((p) => p.category === state.cat);
  items.sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
  if (!items.length) { box.innerHTML = ""; return; }
  box.innerHTML = `
    <div class="quar-head">
      <h2>🆕 新好物 · 檢疫區</h2>
      <p>網友推薦、還沒上榜。幫忙按讚，滿 ${PROMOTE_AT} 讚就正式進排行榜！</p>
    </div>
    <div class="product-grid">${items.map((p) => productCard(p, null)).join("")}</div>`;
  bindCardEvents(box);
}

function productCard(p, rank, opts = {}) {
  const liked = state.liked.has(p.id);
  const inList = state.wishlist.has(p.id);
  const isNew = p.status === "new";
  const progress = isNew ? Math.min(100, Math.round(((p.like_count || 0) / PROMOTE_AT) * 100)) : 0;
  const rankLabel = rank ? `NO.${String(rank).padStart(2, "0")}　` : "";
  const flagLabel = opts.showCountry && COUNTRIES[p.country] ? `<span class="cat-badge">${COUNTRIES[p.country].flag} ${COUNTRIES[p.country].name}</span>` : "";
  const submitLv = p.source === "user" ? levelOf(scoreOf(p.submitted_by).score) : null;
  const submitTag = p.source === "user"
    ? `<span class="pc-tag-user" ${submitLv && submitLv.emoji ? `title="${esc(submitLv.name)}"` : ""}>由 ${esc(state.nickById.get(p.submitted_by) || "網友")} ${submitLv && submitLv.emoji ? submitLv.emoji : ""}推薦</span>`
    : "";
  return `
    <article class="product-card chip-${esc(p.category)}" data-pid="${esc(p.id)}">
      <div class="pc-top">
        ${p.image_url
          ? `<div class="pc-emoji pc-photo"><img src="${esc(p.image_url)}" alt="${esc(p.name_zh)}" loading="lazy" referrerpolicy="no-referrer"></div>`
          : `<div class="pc-emoji">${esc(p.emoji || "🛍️")}</div>`}
        <div class="pc-head">
          <div class="pc-rank">${rankLabel}${flagLabel}<span class="cat-badge">${CATEGORIES[p.category] || ""}</span>${submitTag}</div>
          <div class="pc-name">${esc(p.name_zh)}</div>
          <div class="pc-local">${p.name_local ? esc(p.name_local) : "&nbsp;"}</div>
        </div>
        <button class="pc-report" data-menu="${esc(p.id)}" title="更多">⋯</button>
      </div>
      <p class="pc-reason">${esc(p.reason)}</p>
      <div class="pc-info">
        <div class="pc-price"><b>${esc(p.price_local || "—")}</b>${p.price_twd ? `<span class="pc-twd">${esc(p.price_twd)}</span>` : ""}</div>
        <div class="pc-stars" title="省錢星級">${p.save_stars ? `<span class="pc-stars-label">省錢</span>${stars(p.save_stars)}` : ""}</div>
      </div>
      ${isNew ? `<div class="pc-progress"><div class="pc-progress-bar"><span style="width:${progress}%"></span></div><span class="pc-progress-txt">還差 ${Math.max(0, PROMOTE_AT - (p.like_count || 0))} 讚上榜</span></div>` : ""}
      ${(p.where || []).length ? `<div class="pc-bottom">${(p.where || []).map((w) => `<span class="pc-where">${esc(w)}</span>`).join("")}</div>` : ""}
      <div class="pc-actions">
        <button class="pc-like ${liked ? "on" : ""}" data-like="${esc(p.id)}">
          <span class="heart">${liked ? "❤️" : "🤍"}</span><span class="lc">${p.like_count || 0}</span>
        </button>
        <button class="pc-wish ${inList ? "on" : ""}" data-wish="${esc(p.id)}">${inList ? "✓ 在清單" : "＋ 加入清單"}</button>
        <a class="pc-nav" href="${mapsUrl(p.maps_query)}" target="_blank" rel="noopener">📍 導航</a>
      </div>
    </article>`;
}

function bindCardEvents(root) {
  root.querySelectorAll("[data-like]").forEach((b) => b.onclick = () => toggleLike(b.dataset.like));
  root.querySelectorAll("[data-wish]").forEach((b) => b.onclick = () => toggleWish(b.dataset.wish));
  root.querySelectorAll("[data-menu]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); showCardMenu(b, b.dataset.menu); });
}

/* ---------- 卡片 ⋯ 選單（檢舉 / 補圖）---------- */
function showCardMenu(btn, pid) {
  document.querySelector(".card-menu")?.remove();
  const r = btn.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "card-menu";
  menu.style.top = `${r.bottom + window.scrollY + 4}px`;
  menu.style.left = `${Math.min(r.left + window.scrollX, window.innerWidth - 160)}px`;
  menu.innerHTML = `
    <button data-act="photo">📷 幫忙補圖</button>
    <button data-act="report">⚠️ 檢舉</button>`;
  document.body.appendChild(menu);
  menu.querySelector('[data-act="photo"]').onclick = () => { menu.remove(); showPhotoModal(pid); };
  menu.querySelector('[data-act="report"]').onclick = () => { menu.remove(); reportProduct(pid); };
  setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0);
}

/* ---------- 互動：按讚 / 清單 / 檢舉 ---------- */
async function toggleLike(id) {
  if (!state.user) return requireLogin();
  const p = state.byId.get(id); if (!p) return;
  const liked = state.liked.has(id);
  if (liked) {
    state.liked.delete(id); p.like_count = Math.max(0, (p.like_count || 0) - 1);
    updateLikeUI(id);
    const { error } = await supa.from("likes").delete().eq("user_id", state.user.id).eq("product_id", id);
    if (error) { state.liked.add(id); p.like_count++; updateLikeUI(id); toast("操作失敗，再試一次"); }
  } else {
    state.liked.add(id); p.like_count = (p.like_count || 0) + 1;
    updateLikeUI(id);
    const { error } = await supa.from("likes").insert({ user_id: state.user.id, product_id: id });
    if (error) { state.liked.delete(id); p.like_count--; updateLikeUI(id); toast("操作失敗，再試一次"); return; }
    if (p.status === "new" && p.like_count >= PROMOTE_AT) {
      p.status = "ranked"; toast(`🎉 ${p.name_zh} 集滿 ${PROMOTE_AT} 讚，正式上榜！`);
      if (document.getElementById("grid")) { renderGrid(p.country); renderQuarantine(p.country); }
    }
  }
}
function updateLikeUI(id) {
  const p = state.byId.get(id); const liked = state.liked.has(id);
  document.querySelectorAll(`[data-like="${CSS.escape(id)}"]`).forEach((b) => {
    b.classList.toggle("on", liked);
    b.querySelector(".heart").textContent = liked ? "❤️" : "🤍";
    b.querySelector(".lc").textContent = p.like_count || 0;
  });
}
async function toggleWish(id) {
  if (!state.user) return requireLogin();
  const inList = state.wishlist.has(id);
  if (inList) {
    state.wishlist.delete(id);
    await supa.from("wishlist").delete().eq("user_id", state.user.id).eq("product_id", id);
    toast("已從清單移除");
  } else {
    state.wishlist.set(id, false);
    await supa.from("wishlist").insert({ user_id: state.user.id, product_id: id });
    toast("已加入清單 🧳");
  }
  document.querySelectorAll(`[data-wish="${CSS.escape(id)}"]`).forEach((b) => {
    const on = state.wishlist.has(id);
    b.classList.toggle("on", on); b.textContent = on ? "✓ 在清單" : "＋ 加入清單";
  });
}
async function reportProduct(id) {
  if (!state.user) return requireLogin();
  if (!confirm("確定檢舉這則內容嗎？（廣告、重複、非該國商品等）")) return;
  const { error } = await supa.from("reports").insert({ user_id: state.user.id, product_id: id });
  toast(error ? "你已經檢舉過了" : "已收到檢舉，謝謝你！");
}

/* ---------- 幫忙補圖 ---------- */
function showPhotoModal(pid) {
  if (!state.user) return requireLogin();
  const p = state.byId.get(pid);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-emoji">📷</div>
      <h2 class="modal-title">幫「${esc(p?.name_zh || "這個商品")}」補張圖</h2>
      <p class="modal-sub">選一張清楚的商品照片，通過審核後會顯示在卡片上，你也會 <b>+15 分</b>！<br>（請用實拍或官方圖，別放無關圖片）</p>
      <label class="photo-pick" id="photoPick">📎 選擇照片<input type="file" accept="image/*" id="photoInput" hidden></label>
      <div class="photo-preview" id="photoPreview" hidden><img id="photoImg" alt=""></div>
      <div class="modal-actions">
        <button class="modal-btn primary" id="photoSend" disabled>送出補圖</button>
      </div>
      <button class="modal-close" id="photoClose">取消</button>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  document.getElementById("photoClose").onclick = close;
  const input = document.getElementById("photoInput");
  const sendBtn = document.getElementById("photoSend");
  let file = null;
  document.getElementById("photoPick").onclick = () => input.click();
  input.onchange = () => {
    const f = input.files[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast("請選圖片檔"); return; }
    if (f.size > 5 * 1024 * 1024) { toast("圖片太大了（上限 5MB）"); return; }
    file = f;
    const img = document.getElementById("photoImg");
    img.src = URL.createObjectURL(f);
    document.getElementById("photoPreview").hidden = false;
    document.getElementById("photoPick").textContent = "🔄 重選照片";
    sendBtn.disabled = false;
  };
  sendBtn.onclick = async () => {
    if (!file) return;
    sendBtn.disabled = true; sendBtn.textContent = "上傳中…";
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${pid}/${crypto.randomUUID()}.${ext}`;
    const up = await supa.storage.from("product-images").upload(path, file, { upsert: false });
    if (up.error) { sendBtn.disabled = false; sendBtn.textContent = "送出補圖"; toast("上傳失敗：" + up.error.message); return; }
    const { error } = await supa.from("image_submissions").insert({ product_id: pid, user_id: state.user.id, storage_path: path, status: "pending" });
    if (error) { sendBtn.disabled = false; sendBtn.textContent = "送出補圖"; toast("送出失敗：" + error.message); return; }
    close();
    toast("已送出補圖，等審核通過就會顯示囉！");
  };
}

/* ---------- 使用說明 ---------- */
function showGuideModal() {
  document.querySelector(".modal-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-emoji">🧳</div>
      <h2 class="modal-title">歡迎來到出國購物趣</h2>
      <p class="modal-sub">三個小功能，讓你出國不再煩惱買什麼：</p>
      <ul class="guide-list">
        <li><span>❤️</span><div><b>按讚</b>幫商品加分，讓好物排名往前，被更多人看到。</div></li>
        <li><span>📍</span><div><b>導航</b>一鍵開 Google 地圖找附近店家。<em>建議先確認營業時間、有沒有貨再去，以免白跑一趟。</em></div></li>
        <li><span>🧳</span><div><b>加入清單</b>把想買的收起來，出國邊逛邊打勾。</div></li>
      </ul>
      <div class="modal-actions"><button class="modal-btn primary" id="guideOk">開始逛逛</button></div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); localStorage.setItem("shopfun_guide_seen", "1"); };
  document.getElementById("guideOk").onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
}

/* ---------- 我的清單 ---------- */
function renderList() {
  renderNav(null);
  document.title = "我的購物清單｜出國購物趣";
  if (!state.user) {
    $app.innerHTML = `<section class="page-narrow"><h1 class="page-title">🧳 我的購物清單</h1>
      <div class="empty-state"><div class="big">🔒</div><p>登入後就能把想買的好物收進清單，出國邊逛邊打勾。</p>
      <button class="hero-cta" onclick="__login()">用 Google 登入</button></div></section>`;
    return;
  }
  const ids = [...state.wishlist.keys()];
  const items = ids.map((id) => state.byId.get(id)).filter(Boolean);
  let body;
  if (!items.length) {
    body = `<div class="empty-state"><div class="big">🛒</div><p>清單還是空的。去各國頁面把想買的「＋ 加入清單」吧！</p></div>`;
  } else {
    body = Object.entries(COUNTRIES).map(([c, m]) => {
      const arr = items.filter((p) => p.country === c);
      if (!arr.length) return "";
      arr.sort((a, b) => (state.wishlist.get(a.id) ? 1 : 0) - (state.wishlist.get(b.id) ? 1 : 0));
      const rows = arr.map((p) => {
        const bought = state.wishlist.get(p.id);
        return `<div class="wl-item ${bought ? "bought" : ""}" data-pid="${esc(p.id)}">
          <button class="wl-check" data-bought="${esc(p.id)}">${bought ? "✓" : ""}</button>
          <div class="wl-emoji">${esc(p.emoji || "🛍️")}</div>
          <div class="wl-main">
            <div class="wl-name">${esc(p.name_zh)}</div>
            <div class="wl-meta">${esc(p.price_local || "")}　${(p.where || []).join("・")}</div>
          </div>
          <a class="wl-nav" href="${mapsUrl(p.maps_query)}" target="_blank" rel="noopener">📍</a>
          <button class="wl-remove" data-wish="${esc(p.id)}" title="移除">✕</button>
        </div>`;
      }).join("");
      const done = arr.filter((p) => state.wishlist.get(p.id)).length;
      return `<div class="wl-group"><div class="wl-group-head">${m.flag} ${m.name}<span>${done}/${arr.length} 已買到</span></div>${rows}</div>`;
    }).join("");
  }
  $app.innerHTML = `<section class="page-narrow"><h1 class="page-title">🧳 我的購物清單</h1>${body}</section>`;
  $app.querySelectorAll("[data-bought]").forEach((b) => b.onclick = () => toggleBought(b.dataset.bought));
  $app.querySelectorAll(".wl-remove").forEach((b) => b.onclick = async () => { await toggleWish(b.dataset.wish); renderList(); });
  window.scrollTo(0, 0);
}
async function toggleBought(id) {
  const cur = state.wishlist.get(id) || false;
  state.wishlist.set(id, !cur);
  await supa.from("wishlist").update({ bought: !cur }).eq("user_id", state.user.id).eq("product_id", id);
  renderList();
}

/* ---------- 投稿 ---------- */
function renderSubmit() {
  renderNav(null);
  document.title = "推薦好物｜出國購物趣";
  if (!state.user) {
    $app.innerHTML = `<section class="page-narrow"><h1 class="page-title">＋ 推薦一樣好物</h1>
      <div class="empty-state"><div class="big">🔒</div><p>登入後就能把你的私藏好物推薦給大家。</p>
      <button class="hero-cta" onclick="__login()">用 Google 登入</button></div></section>`;
    return;
  }
  const catOpts = Object.entries(CATEGORIES).filter(([k]) => k !== "all").map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
  const ctryOpts = Object.entries(COUNTRIES).map(([c, m]) => `<option value="${c}">${m.flag} ${m.name}</option>`).join("");
  $app.innerHTML = `<section class="page-narrow">
    <h1 class="page-title">＋ 推薦一樣好物</h1>
    <p class="form-note">新推薦會先進「🆕 新好物」檢疫區，集滿 ${PROMOTE_AT} 個讚就會正式上榜。每人每天最多推 2 樣。</p>
    <form class="sub-form" id="subForm">
      <label>國家<select name="country" required>${ctryOpts}</select></label>
      <label>分類<select name="category" required>${catOpts}</select></label>
      <label>商品名稱<input name="name_zh" required maxlength="40" placeholder="例：薯條三兄弟"></label>
      <label>當地／原文名稱（選填）<input name="name_local" maxlength="60" placeholder="例：じゃがポックル"></label>
      <label>價格帶（選填）<input name="price_local" maxlength="30" placeholder="例：¥900-1,300"></label>
      <label>省錢星級
        <select name="save_stars"><option value="3">★★★ 省一些</option><option value="5">★★★★★ 台灣買不到／超省</option><option value="4">★★★★ 省不少</option><option value="2">★★ 差不多但限定</option><option value="1">★ 沒比較便宜但值得</option></select>
      </label>
      <label>哪裡買（用頓號分隔，選填）<input name="where" maxlength="60" placeholder="例：唐吉訶德、藥妝店"></label>
      <label>Google Maps 導航關鍵字<input name="maps_query" required maxlength="60" placeholder="當地店名最準，例：ドン・キホーテ"></label>
      <label>推薦理由（至少 15 字）<textarea name="reason" required minlength="15" maxlength="120" rows="3" placeholder="為什麼值得買？口感、價差、限定…講重點"></textarea></label>
      <label>代表 Emoji（選填）<input name="emoji" maxlength="4" placeholder="🍟"></label>
      <button type="submit" class="sub-btn">送出推薦</button>
      <div class="sub-msg" id="subMsg"></div>
    </form>
  </section>`;
  document.getElementById("subForm").addEventListener("submit", submitProduct);
  window.scrollTo(0, 0);
}
async function submitProduct(e) {
  e.preventDefault();
  const f = e.target; const msg = document.getElementById("subMsg");
  const btn = f.querySelector(".sub-btn");
  const g = (k) => f.elements[k].value.trim();
  const rec = {
    country: g("country"), category: g("category"),
    name_zh: g("name_zh"), name_local: g("name_local") || null,
    price_local: g("price_local") || null,
    save_stars: parseInt(g("save_stars"), 10),
    where: g("where") ? g("where").split(/[、,，]/).map((s) => s.trim()).filter(Boolean) : [],
    maps_query: g("maps_query"), reason: g("reason"),
    emoji: g("emoji") || "🛍️",
    source: "user", status: "new", submitted_by: state.user.id,
  };
  if (rec.reason.length < 15) { msg.textContent = "推薦理由至少 15 字唷。"; return; }
  // 防重複：同國家相似名稱
  const { data: dup } = await supa.from("products").select("name_zh").eq("country", rec.country).ilike("name_zh", `%${rec.name_zh}%`).limit(1);
  if (dup && dup.length) { msg.innerHTML = `「${esc(dup[0].name_zh)}」好像已經有人推過囉，先去按個讚吧！`; return; }
  btn.disabled = true; btn.textContent = "送出中…";
  const { error } = await supa.from("products").insert(rec);
  btn.disabled = false; btn.textContent = "送出推薦";
  if (error) {
    msg.textContent = error.message.includes("每天") ? error.message : "送出失敗：" + error.message;
    return;
  }
  state.loaded = false; await loadData(); await loadUserState();
  showShareModal(rec.name_zh, rec.country);
}

/* ---------- 上架成功：一鍵分享衝讚彈窗 ---------- */
function shareMessage(name, country) {
  const url = `${location.origin}${location.pathname}#/country/${country}`;
  return `嘿！我在出國購物趣上架了「${name}」🛒 趕快來按讚讓我通過吧 👉 ${url}`;
}
function showShareModal(name, country) {
  const msg = shareMessage(name, country);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-emoji">🎉</div>
      <h2 class="modal-title">上架成功！</h2>
      <p class="modal-sub">「${esc(name)}」已進入新好物檢疫區。<br>把訊息貼到社群，集滿 ${PROMOTE_AT} 個讚就正式上榜！</p>
      <div class="modal-msg" id="shareMsg">${esc(msg)}</div>
      <div class="modal-actions">
        <button class="modal-btn primary" id="copyBtn">📋 複製訊息</button>
        ${cfg.COMMUNITY_URL ? `<a class="modal-btn" href="${esc(cfg.COMMUNITY_URL)}" target="_blank" rel="noopener">💬 開啟 LINE 社群</a>` : ""}
      </div>
      <button class="modal-close" id="modalClose">稍後再說</button>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); if (location.hash !== `#/country/${country}`) location.hash = `#/country/${country}`; else route(); };
  document.getElementById("modalClose").onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  document.getElementById("copyBtn").onclick = async () => {
    const ok = await copyText(msg);
    toast(ok ? "已複製，貼到社群衝讚吧！" : "複製失敗，長按訊息手動複製");
  };
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch (e2) { return false; }
  }
}

/* ---------- 🔥 近期熱門 ---------- */
const hotState = { tab: "week", weekCount: null };
async function renderHot() {
  renderNav("hot");
  document.title = "近期熱門｜出國購物趣";
  $app.innerHTML = `<section class="page-narrow"><h1 class="page-title">🔥 近期熱門</h1>
    <div class="adm-tabs">
      <button class="cat-tab ${hotState.tab === "week" ? "active" : ""}" data-htab="week">近 7 天竄紅</button>
      <button class="cat-tab ${hotState.tab === "all" ? "active" : ""}" data-htab="all">👑 歷史總榜</button>
    </div></section>
    <section class="product-grid" id="grid"></section>`;
  $app.querySelectorAll("[data-htab]").forEach((b) => b.onclick = () => {
    hotState.tab = b.dataset.htab;
    $app.querySelectorAll("[data-htab]").forEach((x) => x.classList.toggle("active", x === b));
    renderHotGrid();
  });
  if (hotState.tab === "week" && !hotState.weekCount) await loadWeekCounts();
  renderHotGrid();
  window.scrollTo(0, 0);
}
async function loadWeekCounts() {
  hotState.weekCount = new Map();
  if (!supa) return;
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data } = await supa.from("likes").select("product_id,created_at").gte("created_at", since);
  (data || []).forEach((l) => hotState.weekCount.set(l.product_id, (hotState.weekCount.get(l.product_id) || 0) + 1));
}
async function renderHotGrid() {
  const grid = document.getElementById("grid");
  if (!grid) return;
  let items = Object.values(state.products).flat().filter((p) => p.status === "ranked");
  if (hotState.tab === "week") {
    if (!hotState.weekCount) { await loadWeekCounts(); }
    items = items.map((p) => ({ p, n: hotState.weekCount.get(p.id) || 0 }))
      .filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 30).map((x) => x.p);
  } else {
    items = items.filter((p) => (p.like_count || 0) > 0).sort((a, b) => (b.like_count || 0) - (a.like_count || 0)).slice(0, 30);
  }
  if (!items.length) {
    grid.innerHTML = `<div class="empty-state"><div class="big">🌱</div><p>${hotState.tab === "week" ? "這 7 天還沒人按讚，快去當第一個！" : "還沒有人按讚，快去逛逛把好物頂上來！"}</p></div>`;
    return;
  }
  grid.innerHTML = items.map((p, i) => productCard(p, i + 1, { showCountry: true })).join("");
  bindCardEvents(grid);
}

/* ---------- 👤 個人設定 ---------- */
const AVATAR_EMOJIS = ["😀","😎","🥰","🤩","😴","🧑","👩","🧔","🐱","🐶","🐰","🦊","🐼","🐸","🍓","🍑","🍜","🍣","✈️","🧳","🛍️","⭐","🌸","🔥"];
const AVATAR_BGS = ["#F3E2D8","#E3D3D8","#D3DBE0","#D5DDD3","#E6DCCB","#EADFF0"];
function renderProfile() {
  renderNav(null);
  document.title = "個人設定｜出國購物趣";
  if (!state.user) {
    $app.innerHTML = `<section class="page-narrow"><h1 class="page-title">👤 個人設定</h1>
      <div class="empty-state"><div class="big">🔒</div><p>登入後就能設定暱稱和頭像。</p>
      <button class="hero-cta" onclick="__login()">用 Google 登入</button></div></section>`;
    return;
  }
  const cur = state.profile || {};
  const selEmoji = cur.avatar_emoji || "😀";
  const selBg = cur.avatar_bg || AVATAR_BGS[0];
  const emojiGrid = AVATAR_EMOJIS.map((e) => `<button type="button" class="emoji-opt ${e === selEmoji ? "on" : ""}" data-emoji="${esc(e)}">${e}</button>`).join("");
  const bgGrid = AVATAR_BGS.map((c) => `<button type="button" class="bg-opt ${c === selBg ? "on" : ""}" data-bg="${c}" style="background:${c}"></button>`).join("");
  const sc = scoreOf(state.user.id);
  const lv = levelOf(sc.score);
  const nx = nextLevel(sc.score);
  const lvProgress = nx ? Math.min(100, Math.round((sc.score / nx.min) * 100)) : 100;
  const levelBlock = `
    <div class="level-card">
      <div class="level-top"><span class="level-emoji">${lv.emoji || "🎒"}</span>
        <div><div class="level-name">${esc(lv.name)}</div><div class="level-sub">貢獻分 ${sc.score}　·　上榜 ${sc.ranked}・獲讚 ${sc.likes}・補圖 ${sc.imgs}</div></div></div>
      ${nx ? `<div class="level-bar"><span style="width:${lvProgress}%"></span></div>
        <div class="level-next">再 ${nx.min - sc.score} 分升級 → ${nx.emoji} ${esc(nx.name)}</div>` : `<div class="level-next">🏆 已達最高等級，你就是傳說！</div>`}
    </div>`;
  $app.innerHTML = `<section class="page-narrow">
    <h1 class="page-title">👤 個人設定</h1>
    <div class="prof-preview"><span class="avatar-emoji lg" id="profPreview" style="background:${esc(selBg)}">${esc(selEmoji)}</span>
      <div><div class="prof-preview-name" id="profPreviewName">${esc(cur.nickname || displayName())} ${lv.emoji || ""}</div><div class="prof-preview-sub">${esc(lv.name)}</div></div></div>
    ${levelBlock}
    <form class="sub-form" id="profForm">
      <label>暱稱<input name="nickname" maxlength="20" value="${esc(cur.nickname || "")}" placeholder="給自己取個名字（1-20 字）"></label>
      <div><div class="prof-label">選一個頭像</div><div class="emoji-grid" id="emojiGrid">${emojiGrid}</div></div>
      <div><div class="prof-label">背景色</div><div class="bg-grid" id="bgGrid">${bgGrid}</div></div>
      <button type="submit" class="sub-btn">儲存</button>
      <div class="sub-msg" id="profMsg"></div>
    </form>
  </section>`;
  let pick = { emoji: selEmoji, bg: selBg };
  const preview = document.getElementById("profPreview");
  const nameInput = $app.querySelector('[name="nickname"]');
  nameInput.oninput = () => { document.getElementById("profPreviewName").textContent = nameInput.value || displayName(); };
  $app.querySelectorAll("[data-emoji]").forEach((b) => b.onclick = () => {
    pick.emoji = b.dataset.emoji; preview.textContent = pick.emoji;
    $app.querySelectorAll("[data-emoji]").forEach((x) => x.classList.toggle("on", x === b));
  });
  $app.querySelectorAll("[data-bg]").forEach((b) => b.onclick = () => {
    pick.bg = b.dataset.bg; preview.style.background = pick.bg;
    $app.querySelectorAll("[data-bg]").forEach((x) => x.classList.toggle("on", x === b));
  });
  document.getElementById("profForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nickname = nameInput.value.trim() || null;
    const rec = { user_id: state.user.id, nickname, avatar_emoji: pick.emoji, avatar_bg: pick.bg, updated_at: new Date().toISOString() };
    const btn = e.target.querySelector(".sub-btn"); btn.disabled = true; btn.textContent = "儲存中…";
    const { error } = await supa.from("profiles").upsert(rec);
    btn.disabled = false; btn.textContent = "儲存";
    if (error) { document.getElementById("profMsg").textContent = "儲存失敗：" + error.message; return; }
    state.profile = { nickname, avatar_emoji: pick.emoji, avatar_bg: pick.bg };
    if (nickname) state.nickById.set(state.user.id, nickname);
    renderRight();
    toast("已儲存 ✨");
  });
  window.scrollTo(0, 0);
}

/* ---------- 🔔 通知中心 ---------- */
async function renderNotifications() {
  renderNav(null);
  document.title = "通知中心｜出國購物趣";
  if (!state.user) {
    $app.innerHTML = `<section class="page-narrow"><h1 class="page-title">🔔 通知中心</h1>
      <div class="empty-state"><div class="big">🔒</div><p>登入後這裡會顯示你的商品上榜、被下架等通知。</p>
      <button class="hero-cta" onclick="__login()">用 Google 登入</button></div></section>`;
    return;
  }
  $app.innerHTML = `<section class="page-narrow"><h1 class="page-title">🔔 通知中心</h1><div id="notiList"><div class="empty-state"><div class="big">⏳</div><p>載入中…</p></div></div></section>`;
  const { data } = await supa.from("notifications").select("*").eq("user_id", state.user.id).order("created_at", { ascending: false });
  const box = document.getElementById("notiList");
  if (!data || !data.length) { box.innerHTML = `<div class="empty-state"><div class="big">📭</div><p>還沒有通知。推薦好物、集讚上榜後這裡會通知你！</p></div>`; }
  else {
    box.innerHTML = data.map((n) => {
      const icon = n.type === "promoted" ? "🎉" : "🗑";
      const text = n.type === "promoted"
        ? `你推薦的「<b>${esc(n.product_name || "商品")}</b>」集滿讚，正式上榜了！`
        : `你推薦的「<b>${esc(n.product_name || "商品")}</b>」已被下架。`;
      const date = new Date(n.created_at).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
      return `<div class="noti-item ${n.read ? "" : "unread"}"><span class="noti-icon">${icon}</span><div class="noti-body"><div class="noti-text">${text}</div><div class="noti-date">${date}</div></div></div>`;
    }).join("");
  }
  // 進頁面即全部標已讀
  if (state.unread > 0) {
    await supa.from("notifications").update({ read: true }).eq("user_id", state.user.id).eq("read", false);
    state.unread = 0; renderRight();
  }
  window.scrollTo(0, 0);
}

/* ---------- 管理後台 ---------- */
const ADMIN_TABS = { stats: "📊 數據", photos: "📷 補圖審核", reported: "🚨 被檢舉", quar: "🆕 檢疫區", all: "📦 全部商品", removed: "🗑 已下架" };
const adm = { products: [], likeCount: new Map(), pending: [], tab: "stats", search: "", country: "all", category: "all", loading: false };

async function loadAdminData() {
  const [{ data: prods, error: e1 }, { data: likes }, imgR] = await Promise.all([
    supa.from("products").select("*"),
    supa.from("likes").select("product_id"),
    supa.from("image_submissions").select("*").eq("status", "pending").order("created_at", { ascending: true }),
  ]);
  if (e1) throw e1;
  adm.likeCount = new Map();
  (likes || []).forEach((l) => adm.likeCount.set(l.product_id, (adm.likeCount.get(l.product_id) || 0) + 1));
  adm.products = (prods || []).map((p) => ({ ...p, like_count: adm.likeCount.get(p.id) || 0 }));
  adm.pending = imgR.error ? [] : (imgR.data || []); // image_submissions 表未建時忽略
}

async function renderAdmin() {
  renderNav(null);
  document.title = "管理後台｜出國購物趣";
  if (!isAdmin()) { toast("沒有管理權限"); location.hash = "#/"; return; }
  $app.innerHTML = `<section class="page-narrow"><h1 class="page-title">⚙️ 管理後台</h1><div class="empty-state"><div class="big">⏳</div><p>載入中…</p></div></section>`;
  try { await loadAdminData(); } catch (e) { $app.querySelector(".empty-state").innerHTML = `<div class="big">⚠️</div><p>載入失敗：${esc(e.message)}</p>`; return; }
  const tabs = Object.entries(ADMIN_TABS).map(([k, l]) => {
    const n = countTab(k);
    return `<button class="cat-tab ${adm.tab === k ? "active" : ""}" data-atab="${k}">${l}${n ? ` <span class="adm-count">${n}</span>` : ""}</button>`;
  }).join("");
  $app.innerHTML = `<section class="page-narrow">
    <h1 class="page-title">⚙️ 管理後台</h1>
    <div class="adm-tabs">${tabs}</div>
    <div class="adm-toolbar" id="admToolbar"></div>
    <div class="adm-list" id="admList"></div>
  </section>`;
  $app.querySelectorAll("[data-atab]").forEach((b) => b.onclick = () => { adm.tab = b.dataset.atab; adm.search = ""; adm.country = "all"; adm.category = "all"; renderAdmin(); });
  if (adm.tab === "stats") { renderAdminStats(); }
  else if (adm.tab === "photos") { document.getElementById("admToolbar").innerHTML = ""; renderAdminPhotos(); }
  else { renderAdminToolbar(); renderAdminList(); }
  window.scrollTo(0, 0);
}

async function renderAdminPhotos() {
  const box = document.getElementById("admList");
  if (!adm.pending.length) { box.innerHTML = `<div class="empty-state"><div class="big">📷</div><p>目前沒有待審的補圖。</p></div>`; return; }
  box.innerHTML = adm.pending.map((s) => {
    const p = adm.products.find((x) => x.id === s.product_id);
    const url = supa.storage.from("product-images").getPublicUrl(s.storage_path).data.publicUrl;
    const nick = state.nickById.get(s.user_id) || "網友";
    return `<div class="photo-row">
      <img class="photo-thumb" src="${esc(url)}" alt="" loading="lazy">
      <div class="adm-main"><div class="adm-name">${esc(p ? p.name_zh : "（商品已不存在）")}</div><div class="adm-meta">${esc(COUNTRIES[p?.country]?.name || "")} · 由 ${esc(nick)} 補圖</div></div>
      <div class="adm-actions">
        <button class="adm-btn ok" data-pact="approve" data-sid="${esc(s.id)}">通過</button>
        <button class="adm-btn danger" data-pact="reject" data-sid="${esc(s.id)}">退回</button>
      </div>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-pact]").forEach((b) => b.onclick = () => photoReview(b.dataset.pact, b.dataset.sid));
}

async function photoReview(act, sid) {
  const sub = adm.pending.find((x) => x.id === sid);
  if (!sub) return;
  if (act === "approve") {
    const url = supa.storage.from("product-images").getPublicUrl(sub.storage_path).data.publicUrl;
    const r1 = await supa.from("image_submissions").update({ status: "approved" }).eq("id", sid).select();
    if (r1.error || !r1.data?.length) { toast("操作失敗，或沒有權限"); return; }
    await supa.from("products").update({ image_url: url }).eq("id", sub.product_id);
    toast("已通過，商品卡會顯示這張圖 ✅");
  } else {
    const r1 = await supa.from("image_submissions").update({ status: "rejected" }).eq("id", sid).select();
    if (r1.error || !r1.data?.length) { toast("操作失敗，或沒有權限"); return; }
    supa.storage.from("product-images").remove([sub.storage_path]); // 清掉退回的檔（失敗不影響）
    toast("已退回");
  }
  adm.pending = adm.pending.filter((x) => x.id !== sid);
  state.loaded = false; // 前台重載以顯示新圖
  renderAdmin();
}

async function renderAdminStats() {
  const box = document.getElementById("admList");
  document.getElementById("admToolbar").innerHTML = "";
  box.innerHTML = `<div class="empty-state"><div class="big">⏳</div><p>載入數據中…</p></div>`;
  let s;
  try { const { data, error } = await supa.rpc("admin_stats"); if (error) throw error; s = data; }
  catch (e) { box.innerHTML = `<div class="empty-state"><div class="big">⚠️</div><p>讀取數據失敗：${esc(e.message)}<br><small>（是否已跑 admin_stats 的 SQL？）</small></p></div>`; return; }
  const num = (n) => Number(n || 0).toLocaleString();
  const card = (icon, label, content, sub) => `
    <div class="stat-card"><div class="stat-label">${icon} ${label}</div><div class="stat-num">${content}</div><div class="stat-sub">${sub}</div></div>`;
  box.innerHTML = `<div class="stat-grid">
    ${card("👤", "註冊用戶", num(s.users), `近 7 天 +${num(s.users_7d)}`)}
    ${card("🛒", "上架商品", num(s.ranked), `含網友投稿 ${num(s.user_submitted)} 樣`)}
    ${card("❤️", "總按讚數", num(s.likes), `近 7 天 +${num(s.likes_7d)}`)}
    ${card("⚡", "目前線上", `<span id="statOnline">${onlineCount()}</span>`, "即時在線人數")}
  </div>`;
}

function countTab(tab) {
  const P = adm.products;
  if (tab === "photos") return adm.pending.length;
  if (tab === "reported") return P.filter((p) => p.report_count > 0 && p.status !== "removed").length;
  if (tab === "quar") return P.filter((p) => p.status === "new").length;
  if (tab === "all") return P.filter((p) => p.status === "ranked").length;
  if (tab === "removed") return P.filter((p) => p.status === "removed").length;
  return 0;
}

function adminRows() {
  let rows = [...adm.products];
  if (adm.tab === "reported") rows = rows.filter((p) => p.report_count > 0 && p.status !== "removed").sort((a, b) => b.report_count - a.report_count);
  else if (adm.tab === "quar") rows = rows.filter((p) => p.status === "new").sort((a, b) => (b.like_count - a.like_count) || (new Date(b.created_at) - new Date(a.created_at)));
  else if (adm.tab === "all") {
    rows = rows.filter((p) => p.status === "ranked");
    if (adm.country !== "all") rows = rows.filter((p) => p.country === adm.country);
    if (adm.category !== "all") rows = rows.filter((p) => p.category === adm.category);
    if (adm.search) rows = rows.filter((p) => (p.name_zh || "").toLowerCase().includes(adm.search.toLowerCase()));
    rows.sort((a, b) => b.like_count - a.like_count);
  } else if (adm.tab === "removed") rows = rows.filter((p) => p.status === "removed");
  return rows;
}

function renderAdminToolbar() {
  const bar = document.getElementById("admToolbar");
  if (adm.tab !== "all") { bar.innerHTML = ""; return; }
  const ctryOpts = `<option value="all">全部國家</option>` + Object.entries(COUNTRIES).map(([c, m]) => `<option value="${c}" ${adm.country === c ? "selected" : ""}>${m.flag} ${m.name}</option>`).join("");
  const catOpts = Object.entries(CATEGORIES).map(([c, l]) => `<option value="${c}" ${adm.category === c ? "selected" : ""}>${c === "all" ? "全部分類" : l}</option>`).join("");
  bar.innerHTML = `
    <input class="adm-search" id="admSearch" placeholder="🔍 搜尋商品名稱" value="${esc(adm.search)}">
    <select class="sort-select" id="admCountry">${ctryOpts}</select>
    <select class="sort-select" id="admCategory">${catOpts}</select>`;
  const si = document.getElementById("admSearch");
  si.oninput = () => { adm.search = si.value; renderAdminList(); };
  document.getElementById("admCountry").onchange = (e) => { adm.country = e.target.value; renderAdminList(); };
  document.getElementById("admCategory").onchange = (e) => { adm.category = e.target.value; renderAdminList(); };
}

function renderAdminList() {
  const box = document.getElementById("admList");
  const rows = adminRows();
  if (!rows.length) { box.innerHTML = `<div class="empty-state"><div class="big">✨</div><p>這個分頁沒有東西，很乾淨！</p></div>`; return; }
  box.innerHTML = rows.map((p) => {
    const m = COUNTRIES[p.country] || {};
    const date = p.created_at ? new Date(p.created_at).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" }) : "";
    const meta = `${m.flag || ""} ${CATEGORIES[p.category] || ""}　❤️ ${p.like_count}${p.report_count ? `　🚨 ${p.report_count}` : ""}${date ? `　${date}` : ""}${p.source === "user" ? "　網友" : ""}`;
    let actions = "";
    if (adm.tab === "reported") actions = `<button class="adm-btn danger" data-act="remove" data-id="${esc(p.id)}">下架</button><button class="adm-btn" data-act="clear" data-id="${esc(p.id)}">清除檢舉</button>`;
    else if (adm.tab === "quar") actions = `<button class="adm-btn ok" data-act="promote" data-id="${esc(p.id)}">直接轉正</button><button class="adm-btn danger" data-act="remove" data-id="${esc(p.id)}">下架</button>`;
    else if (adm.tab === "all") actions = `<button class="adm-btn danger" data-act="remove" data-id="${esc(p.id)}">下架</button>`;
    else if (adm.tab === "removed") actions = `<button class="adm-btn ok" data-act="restore" data-id="${esc(p.id)}">恢復上架</button><button class="adm-btn danger" data-act="purge" data-id="${esc(p.id)}">永久刪除</button>`;
    return `<div class="adm-row">
      <div class="wl-emoji">${esc(p.emoji || "🛍️")}</div>
      <div class="adm-main"><div class="adm-name">${esc(p.name_zh)}</div><div class="adm-meta">${meta}</div></div>
      <div class="adm-actions">${actions}</div>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-act]").forEach((b) => b.onclick = () => adminAction(b.dataset.act, b.dataset.id));
}

async function adminAction(act, id) {
  const p = adm.products.find((x) => x.id === id);
  if (!p) return;
  if (act === "purge") {
    if (!confirm(`永久刪除「${p.name_zh}」？刪除後無法復原。`)) return;
    if (!confirm(`真的確定嗎？此動作不可逆，連同它的讚、清單、檢舉都會一起清除。`)) return;
    const { error } = await supa.rpc("admin_purge", { pid: id });
    if (error) { toast("刪除失敗：" + error.message); return; }
    adm.products = adm.products.filter((x) => x.id !== id);
    state.loaded = false;
    toast("已永久刪除");
    renderAdmin();
    return;
  }
  let patch, msg;
  if (act === "remove") { if (!confirm(`確定下架「${p.name_zh}」？（可從已下架分頁恢復）`)) return; patch = { status: "removed" }; msg = "已下架"; }
  else if (act === "clear") { patch = { report_count: 0 }; msg = "已清除檢舉"; }
  else if (act === "promote") { patch = { status: "ranked" }; msg = "已轉正上榜 🎉"; }
  else if (act === "restore") { const st = (p.source === "seed" || p.like_count >= PROMOTE_AT) ? "ranked" : "new"; patch = { status: st }; msg = st === "ranked" ? "已恢復上架" : "已送回檢疫區"; }
  const { data, error } = await supa.from("products").update(patch).eq("id", id).select();
  if (error) { toast("操作失敗：" + error.message); return; }
  if (!data || !data.length) { toast("沒有權限，或該筆已被異動"); return; }
  Object.assign(p, patch);
  state.loaded = false; // 讓前台頁面下次重載
  toast(msg);
  renderAdmin();
}

/* ---------- Router ---------- */
async function route() {
  await loadData();
  const hash = location.hash || "#/";
  let m;
  if ((m = hash.match(/^#\/country\/(\w+)/))) { state.cat = "all"; renderCountry(m[1]); }
  else if (hash.startsWith("#/admin")) renderAdmin();
  else if (hash.startsWith("#/hot")) renderHot();
  else if (hash.startsWith("#/profile")) renderProfile();
  else if (hash.startsWith("#/notifications")) renderNotifications();
  else if (hash.startsWith("#/list")) renderList();
  else if (hash.startsWith("#/submit")) renderSubmit();
  else renderHome();
}

/* ---------- 線上人數（Realtime Presence）---------- */
let presenceChannel = null;
function initPresence() {
  if (!supa || presenceChannel) return;
  const key = (window.crypto?.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  presenceChannel = supa.channel("online", { config: { presence: { key } } });
  presenceChannel.on("presence", { event: "sync" }, () => {
    const el = document.getElementById("statOnline");
    if (el) el.textContent = onlineCount();
  });
  presenceChannel.subscribe((status) => { if (status === "SUBSCRIBED") presenceChannel.track({ at: Date.now() }); });
}
function onlineCount() {
  if (!presenceChannel) return 0;
  try { return Object.keys(presenceChannel.presenceState()).length; } catch (e) { return 0; }
}

/* ---------- PWA：加到主畫面 ---------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; });
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function showInstallModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  let body;
  if (isStandalone()) {
    body = `<div class="modal-emoji">✅</div><h2 class="modal-title">已經裝好了！</h2>
      <p class="modal-sub">你正在用 App 模式開啟出國購物趣，畫面乾淨、開啟超快。</p>`;
  } else if (deferredPrompt) {
    body = `<div class="modal-emoji">📲</div><h2 class="modal-title">加到主畫面</h2>
      <p class="modal-sub">裝起來像真的 App：桌面有圖示、全螢幕開啟、開啟秒速。</p>
      <div class="modal-actions"><button class="modal-btn primary" id="installNow">🚀 立即安裝</button></div>`;
  } else if (isIOS()) {
    body = `<div class="modal-emoji">📲</div><h2 class="modal-title">加到 iPhone 主畫面</h2>
      <p class="modal-sub">用 <b>Safari</b> 開啟本站，照著做只要 3 步：</p>
      <ol class="install-steps">
        <li>點畫面最下方的「分享」<span class="ib">􀈂 📤</span></li>
        <li>往下滑，選「加入主畫面」<span class="ib">➕</span></li>
        <li>右上角按「加入」就完成！</li>
      </ol>`;
  } else {
    body = `<div class="modal-emoji">📲</div><h2 class="modal-title">加到手機主畫面</h2>
      <p class="modal-sub">用手機瀏覽器開啟本站，就能像 App 一樣裝到桌面：</p>
      <ol class="install-steps">
        <li><b>iPhone</b>：Safari →「分享 📤」→「加入主畫面」</li>
        <li><b>Android</b>：Chrome 右上「⋮」→「安裝應用程式／加到主畫面」</li>
      </ol>
      <div class="modal-msg">${esc(location.origin + location.pathname)}</div>`;
  }
  overlay.innerHTML = `<div class="modal">${body}<button class="modal-close" id="installClose">關閉</button></div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  document.getElementById("installClose").onclick = close;
  const now = document.getElementById("installNow");
  if (now) now.onclick = async () => {
    close();
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") toast("安裝中… 到主畫面找橘色「趣」圖示！");
    deferredPrompt = null;
  };
}

window.__login = login;
window.__guide = showGuideModal; // footer「使用說明」用
window.addEventListener("hashchange", route);

/* ---------- 啟動 ---------- */
(async function boot() {
  if (supa) {
    initPresence();
    await refreshUser();
    supa.auth.onAuthStateChange(async (_evt, session) => {
      state.user = session ? session.user : null;
      await loadUserState();
      renderRight(); route();
    });
    // 登入導回後還原原本頁面
    const rh = sessionStorage.getItem("returnHash");
    if (rh && state.user) { sessionStorage.removeItem("returnHash"); if (location.hash !== rh) location.hash = rh; }
  }
  renderRight();
  await route();          // route() 內 loadData() 完成後，products 才進 state
  renderRight();          // 再渲染一次，讓選單積分行拿到正確分數（首次 renderRight 時資料還沒到）
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW 註冊失敗：", e.message));
  }
  if (!localStorage.getItem("shopfun_guide_seen")) setTimeout(showGuideModal, 600); // 首次到訪自動說明
})();
