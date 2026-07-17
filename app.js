/* ============ 購物趣 SPA ============ */

const COUNTRIES = {
  jp: {
    name: "日本",
    flag: "🇯🇵",
    tagline: "藥妝、零食、生活小物的天堂，唐吉訶德一逛就是三小時",
    currency: "日圓 JPY",
    tint: "#E3D3D8",
    file: "data/seed_jp.json",
  },
  kr: {
    name: "韓國",
    flag: "🇰🇷",
    tagline: "Olive Young 美妝挖寶＋便利商店零食，行李箱永遠不夠裝",
    currency: "韓元 KRW",
    tint: "#D3DBE0",
    file: "data/seed_kr.json",
  },
  th: {
    name: "泰國",
    flag: "🇹🇭",
    tagline: "Big C 零食掃貨＋草本藥品保健，便宜到懷疑人生",
    currency: "泰銖 THB",
    tint: "#D5DDD3",
    file: "data/seed_th.json",
  },
};

const CATEGORIES = {
  all: "全部",
  snacks: "零食",
  beauty: "美妝藥妝",
  daily: "生活小物",
  health: "藥品保健",
  souvenir: "伴手禮",
};

const SORTS = {
  rank: "必買指數",
  save: "省錢星級",
};

const state = {
  products: {},      // country -> array
  loaded: false,
  cat: "all",
  sort: "rank",
};

const $app = document.getElementById("app");
const $nav = document.getElementById("topnav");

/* ---------- 資料載入 ---------- */
async function loadData() {
  if (state.loaded) return;
  const entries = Object.entries(COUNTRIES);
  const results = await Promise.allSettled(
    entries.map(([, meta]) => fetch(meta.file).then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }))
  );
  entries.forEach(([code], i) => {
    state.products[code] = results[i].status === "fulfilled" ? results[i].value : [];
  });
  state.loaded = true;
}

/* ---------- 工具 ---------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function stars(n) {
  const full = "★".repeat(n);
  const dim = "☆".repeat(5 - n);
  return `${full}<span class="dim">${dim}</span>`;
}

function mapsUrl(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/* ---------- 頂欄 ---------- */
function renderNav(active) {
  $nav.innerHTML = Object.entries(COUNTRIES)
    .map(([code, m]) =>
      `<a href="#/country/${code}" class="${active === code ? "active" : ""}">${m.flag} ${m.name}</a>`)
    .join("");
}

/* ---------- 首頁 ---------- */
function renderHome() {
  renderNav(null);
  document.title = "購物趣｜出國必買好物指南";
  const cards = Object.entries(COUNTRIES)
    .map(([code, m]) => {
      const count = (state.products[code] || []).length;
      return `
      <a class="country-card" href="#/country/${code}" style="--tint:${m.tint}">
        <div class="country-flag">${m.flag}</div>
        <h2>${m.name}</h2>
        <p class="country-tagline">${m.tagline}</p>
        <div class="country-meta">
          <span>${count ? `${count} 樣必買好物` : "整理中"}</span>
          <span class="go">去逛逛 →</span>
        </div>
      </a>`;
    })
    .join("");

  $app.innerHTML = `
    <section class="hero">
      <div class="hero-kicker">出國購物指南</div>
      <h1>出國不知道買什麼？<br>讓<em>購物趣</em>當你的行李清單</h1>
      <p>必買好物 × 省錢星級 × 一鍵導航到最近的店</p>
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

  const catTabs = Object.entries(CATEGORIES)
    .map(([key, label]) =>
      `<button class="cat-tab ${state.cat === key ? "active" : ""}" data-cat="${key}">${label}</button>`)
    .join("");

  const sortOptions = Object.entries(SORTS)
    .map(([key, label]) =>
      `<option value="${key}" ${state.sort === key ? "selected" : ""}>${label}</option>`)
    .join("");

  $app.innerHTML = `
    <section class="country-head">
      <span class="flag">${meta.flag}</span>
      <h1>${meta.name}必買好物</h1>
      <span class="sub">價格以${meta.currency}計，台幣為約略換算</span>
    </section>
    <div class="toolbar">
      <div class="toolbar-inner">
        <div class="cat-tabs">${catTabs}</div>
        <div class="toolbar-spacer"></div>
        <div class="sort-wrap">
          排序
          <select class="sort-select" id="sortSel">${sortOptions}</select>
        </div>
      </div>
    </div>
    <section class="product-grid" id="grid"></section>`;

  $app.querySelectorAll(".cat-tab").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.cat = btn.dataset.cat;
      $app.querySelectorAll(".cat-tab").forEach((b) => b.classList.toggle("active", b === btn));
      renderGrid(code);
    })
  );
  document.getElementById("sortSel").addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderGrid(code);
  });

  renderGrid(code);
  window.scrollTo(0, 0);
}

function renderGrid(code) {
  const grid = document.getElementById("grid");
  let items = [...(state.products[code] || [])];

  if (state.cat !== "all") items = items.filter((p) => p.category === state.cat);

  if (state.sort === "save") {
    items.sort((a, b) => b.save_stars - a.save_stars || a.editor_rank - b.editor_rank);
  } else {
    items.sort((a, b) => a.editor_rank - b.editor_rank);
  }

  if (!items.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="big">🧳</div>
        <p>這個分類還在整理中，先逛逛其他分類吧！</p>
      </div>`;
    return;
  }

  grid.innerHTML = items
    .map((p, i) => `
    <article class="product-card chip-${esc(p.category)}">
      <div class="pc-top">
        <div class="pc-emoji">${esc(p.emoji)}</div>
        <div>
          <div class="pc-rank">NO.${String(i + 1).padStart(2, "0")}　<span class="cat-badge">${CATEGORIES[p.category] || ""}</span></div>
          <div class="pc-name">${esc(p.name_zh)}</div>
          <div class="pc-local">${esc(p.name_local)}</div>
        </div>
      </div>
      <p class="pc-reason">${esc(p.reason)}</p>
      <div class="pc-info">
        <span class="pc-price"><b>${esc(p.price_local)}</b>｜${esc(p.price_twd)}</span>
        <span class="pc-stars" title="省錢星級">${stars(p.save_stars)}<span class="pc-stars-label">省錢</span></span>
      </div>
      <div class="pc-bottom">
        ${(p.where || []).map((w) => `<span class="pc-where">${esc(w)}</span>`).join("")}
        <a class="pc-nav" href="${mapsUrl(p.maps_query)}" target="_blank" rel="noopener">📍 導航最近的店</a>
      </div>
    </article>`)
    .join("");
}

/* ---------- Router ---------- */
async function route() {
  await loadData();
  const hash = location.hash || "#/";
  const m = hash.match(/^#\/country\/(\w+)/);
  if (m) {
    state.cat = "all";
    renderCountry(m[1]);
  } else {
    renderHome();
  }
}

window.addEventListener("hashchange", route);
route();
