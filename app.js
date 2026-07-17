/* ============ 購物趣 SPA · V2（Supabase：登入／按讚／清單／投稿／檢疫區）============ */

const COUNTRIES = {
  jp: { name: "日本", flag: "🇯🇵", tagline: "藥妝、零食、生活小物的天堂，唐吉訶德一逛就是三小時", currency: "日圓 JPY", tint: "#E3D3D8" },
  kr: { name: "韓國", flag: "🇰🇷", tagline: "Olive Young 美妝挖寶＋便利商店零食，行李箱永遠不夠裝", currency: "韓元 KRW", tint: "#D3DBE0" },
  th: { name: "泰國", flag: "🇹🇭", tagline: "Big C 零食掃貨＋草本藥品保健，便宜到懷疑人生", currency: "泰銖 THB", tint: "#D5DDD3" },
};
const SEED_FILE = { jp: "data/seed_jp.json", kr: "data/seed_kr.json", th: "data/seed_th.json" };

const CATEGORIES = { all: "全部", snacks: "零食", beauty: "美妝藥妝", daily: "生活小物", health: "藥品保健", souvenir: "伴手禮" };
const SORTS = { hot: "🔥 熱門", save: "省錢星級", rank: "必買指數" };
const PROMOTE_AT = 10; // 檢疫區轉正門檻

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
  if (!supa || !state.user) return;
  const [{ data: likes }, { data: wish }] = await Promise.all([
    supa.from("likes").select("product_id").eq("user_id", state.user.id),
    supa.from("wishlist").select("product_id,bought").eq("user_id", state.user.id),
  ]);
  (likes || []).forEach((l) => state.liked.add(l.product_id));
  (wish || []).forEach((w) => state.wishlist.set(w.product_id, w.bought));
}
async function login() {
  if (!supa) return toast("登入功能尚未設定");
  sessionStorage.setItem("returnHash", location.hash || "#/");
  await supa.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
}
async function logout() {
  await supa.auth.signOut();
  state.user = null; state.liked = new Set(); state.wishlist = new Map();
  renderRight(); route();
  toast("已登出");
}
function requireLogin() { toast("請先用 Google 登入 👇"); login(); }

/* ---------- 頂欄 ---------- */
function renderNav(active) {
  $nav.innerHTML = Object.entries(COUNTRIES)
    .map(([c, m]) => `<a href="#/country/${c}" class="${active === c ? "active" : ""}">${m.flag} ${m.name}</a>`)
    .join("");
}
function renderRight() {
  if (!supa) { $right.innerHTML = ""; return; }
  if (state.user) {
    const u = state.user;
    const name = u.user_metadata?.name || u.email || "我";
    const avatar = u.user_metadata?.avatar_url
      ? `<img src="${esc(u.user_metadata.avatar_url)}" alt="" referrerpolicy="no-referrer">`
      : `<span class="avatar-fallback">${esc(name[0] || "我")}</span>`;
    $right.innerHTML = `
      ${isAdmin() ? `<a href="#/admin" class="tb-link tb-admin" title="管理後台">⚙️ 管理</a>` : ""}
      <a href="#/list" class="tb-link" title="我的清單">🧳 清單</a>
      <a href="#/submit" class="tb-link tb-cta">＋ 推好物</a>
      <div class="tb-user" id="tbUser">${avatar}</div>
      <div class="tb-menu" id="tbMenu" hidden>
        <div class="tb-menu-name">${esc(name)}</div>
        <button id="btnLogout">登出</button>
      </div>`;
    const menu = document.getElementById("tbMenu");
    document.getElementById("tbUser").onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    document.getElementById("btnLogout").onclick = logout;
    document.addEventListener("click", () => { menu.hidden = true; }, { once: true });
  } else {
    $right.innerHTML = `<button class="tb-login" id="btnLogin">Google 登入</button>`;
    document.getElementById("btnLogin").onclick = login;
  }
}

/* ---------- 首頁 ---------- */
function renderHome() {
  renderNav(null);
  document.title = "購物趣｜出國必買好物指南";
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
    <section class="country-grid">${cards}</section>`;
  window.scrollTo(0, 0);
}

/* ---------- 國家頁 ---------- */
function renderCountry(code) {
  const meta = COUNTRIES[code];
  if (!meta) return renderHome();
  renderNav(code);
  document.title = `${meta.name}必買好物｜購物趣`;
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
  bindCardEvents(grid, code);
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
  bindCardEvents(box, code);
}

function productCard(p, rank) {
  const liked = state.liked.has(p.id);
  const inList = state.wishlist.has(p.id);
  const isNew = p.status === "new";
  const progress = isNew ? Math.min(100, Math.round(((p.like_count || 0) / PROMOTE_AT) * 100)) : 0;
  const rankLabel = rank ? `NO.${String(rank).padStart(2, "0")}　` : "";
  return `
    <article class="product-card chip-${esc(p.category)}" data-pid="${esc(p.id)}">
      <div class="pc-top">
        <div class="pc-emoji">${esc(p.emoji || "🛍️")}</div>
        <div class="pc-head">
          <div class="pc-rank">${rankLabel}<span class="cat-badge">${CATEGORIES[p.category] || ""}</span>${p.source === "user" ? `<span class="pc-tag-user">網友推薦</span>` : ""}</div>
          <div class="pc-name">${esc(p.name_zh)}</div>
          ${p.name_local ? `<div class="pc-local">${esc(p.name_local)}</div>` : ""}
        </div>
        <button class="pc-report" data-report="${esc(p.id)}" title="檢舉不當內容">⋯</button>
      </div>
      <p class="pc-reason">${esc(p.reason)}</p>
      <div class="pc-info">
        <div class="pc-price"><b>${esc(p.price_local || "—")}</b>${p.price_twd ? `<span class="pc-twd">${esc(p.price_twd)}</span>` : ""}</div>
        <div class="pc-stars" title="省錢星級">${p.save_stars ? `<span class="pc-stars-label">省錢</span>${stars(p.save_stars)}` : ""}</div>
      </div>
      ${isNew ? `<div class="pc-progress"><div class="pc-progress-bar"><span style="width:${progress}%"></span></div><span class="pc-progress-txt">還差 ${Math.max(0, PROMOTE_AT - (p.like_count || 0))} 讚上榜</span></div>` : ""}
      <div class="pc-bottom">
        ${(p.where || []).map((w) => `<span class="pc-where">${esc(w)}</span>`).join("")}
        <a class="pc-nav" href="${mapsUrl(p.maps_query)}" target="_blank" rel="noopener">📍 導航</a>
      </div>
      <div class="pc-actions">
        <button class="pc-like ${liked ? "on" : ""}" data-like="${esc(p.id)}">
          <span class="heart">${liked ? "❤️" : "🤍"}</span><span class="lc">${p.like_count || 0}</span>
        </button>
        <button class="pc-wish ${inList ? "on" : ""}" data-wish="${esc(p.id)}">${inList ? "✓ 在清單" : "＋ 加入清單"}</button>
      </div>
    </article>`;
}

function bindCardEvents(root, code) {
  root.querySelectorAll("[data-like]").forEach((b) => b.onclick = () => toggleLike(b.dataset.like, code));
  root.querySelectorAll("[data-wish]").forEach((b) => b.onclick = () => toggleWish(b.dataset.wish));
  root.querySelectorAll("[data-report]").forEach((b) => b.onclick = () => reportProduct(b.dataset.report));
}

/* ---------- 互動：按讚 / 清單 / 檢舉 ---------- */
async function toggleLike(id, code) {
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
      renderGrid(code); renderQuarantine(code);
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

/* ---------- 我的清單 ---------- */
function renderList() {
  renderNav(null);
  document.title = "我的購物清單｜購物趣";
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
  document.title = "推薦好物｜購物趣";
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
  toast("🎉 推薦成功！已進入新好物檢疫區");
  location.hash = `#/country/${rec.country}`;
}

/* ---------- 管理後台 ---------- */
const ADMIN_TABS = { reported: "🚨 被檢舉", quar: "🆕 檢疫區", all: "📦 全部商品", removed: "🗑 已下架" };
const adm = { products: [], likeCount: new Map(), tab: "reported", search: "", country: "all", loading: false };

async function loadAdminData() {
  const [{ data: prods, error: e1 }, { data: likes }] = await Promise.all([
    supa.from("products").select("*"),
    supa.from("likes").select("product_id"),
  ]);
  if (e1) throw e1;
  adm.likeCount = new Map();
  (likes || []).forEach((l) => adm.likeCount.set(l.product_id, (adm.likeCount.get(l.product_id) || 0) + 1));
  adm.products = (prods || []).map((p) => ({ ...p, like_count: adm.likeCount.get(p.id) || 0 }));
}

async function renderAdmin() {
  renderNav(null);
  document.title = "管理後台｜購物趣";
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
  $app.querySelectorAll("[data-atab]").forEach((b) => b.onclick = () => { adm.tab = b.dataset.atab; renderAdmin(); });
  renderAdminToolbar();
  renderAdminList();
  window.scrollTo(0, 0);
}

function countTab(tab) {
  const P = adm.products;
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
    if (adm.search) rows = rows.filter((p) => (p.name_zh || "").toLowerCase().includes(adm.search.toLowerCase()));
    rows.sort((a, b) => b.like_count - a.like_count);
  } else if (adm.tab === "removed") rows = rows.filter((p) => p.status === "removed");
  return rows;
}

function renderAdminToolbar() {
  const bar = document.getElementById("admToolbar");
  if (adm.tab !== "all") { bar.innerHTML = ""; return; }
  const ctryOpts = `<option value="all">全部國家</option>` + Object.entries(COUNTRIES).map(([c, m]) => `<option value="${c}" ${adm.country === c ? "selected" : ""}>${m.flag} ${m.name}</option>`).join("");
  bar.innerHTML = `
    <input class="adm-search" id="admSearch" placeholder="🔍 搜尋商品名稱" value="${esc(adm.search)}">
    <select class="sort-select" id="admCountry">${ctryOpts}</select>`;
  const si = document.getElementById("admSearch");
  si.oninput = () => { adm.search = si.value; renderAdminList(); };
  document.getElementById("admCountry").onchange = (e) => { adm.country = e.target.value; renderAdminList(); };
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
    else if (adm.tab === "removed") actions = `<button class="adm-btn ok" data-act="restore" data-id="${esc(p.id)}">恢復上架</button>`;
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
  else if (hash.startsWith("#/list")) renderList();
  else if (hash.startsWith("#/submit")) renderSubmit();
  else renderHome();
}

window.__login = login;
window.addEventListener("hashchange", route);

/* ---------- 啟動 ---------- */
(async function boot() {
  if (supa) {
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
  await route();
})();
