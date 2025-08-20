/**
 * データ取得先（Google スプレッドシートのCSVエンドポイント）
 */
const SHEET_ID = "15HrZzb_hLIr60puibPqMK-d2Xk8KARgL-Ia60TwElok";
const DEFAULT_GID = "0";
const urlParams = new URLSearchParams(location.search);
const ACTIVE_GID = urlParams.get("gid") || DEFAULT_GID;
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${encodeURIComponent(ACTIVE_GID)}`;

// 列名（日本語ヘッダー）
const COL = {
  NAME: "施設名",
  AUTHOR: "作成者",
  TYPE: "タイプ",
  REGION: "地域(任意)",
  X: "x座標",
  Y: "y座標(任意)",
  Z: "z座標",
  DESC: "説明",
  TAGS: "タグ(,区切り)",
};

// 未選択・空欄を表す特別な値
const UNSELECTED = "選択";

// DOM 参照
const el = {
  lastUpdated: document.getElementById("last-updated"),
  search: document.getElementById("search"),
  authorFilter: document.getElementById("authorFilter"),
  typeFilter: document.getElementById("typeFilter"),
  regionFilter: document.getElementById("regionFilter"),
  sortSelect: document.getElementById("sortSelect"),
  netherToggle: document.getElementById("netherToggle"),
  tabCards: document.getElementById("tabCards"),
  tabTable: document.getElementById("tabTable"),
  cards: document.getElementById("cardsContainer"),
  tableWrapper: document.getElementById("tableWrapper"),
  table: document.getElementById("dataTable"),
  counts: document.getElementById("counts"),
  errorPanel: document.getElementById("errorPanel"),
  retryBtn: document.getElementById("retryBtn"),
  toast: document.getElementById("toast-container"),
};

/** アプリ状態 */
const state = {
  data: [],
  filtered: [],
  search: "",
  author: "__ALL__",
  type: "__ALL__",
  region: "__ALL__",
  sort: "nameAsc",
  showNether: false,
  view: "cards",
  lastFetchedAt: null,
};

/** CSV をダウンロードして文字列で返す */
async function fetchCsv(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  state.lastFetchedAt = new Date();
  return text;
}

/** CSV文字列をパースし、オブジェクト配列に変換 */
function parseCsv(text) {
  const rows = csvToRows(text);
  if (rows.length < 1) return [];
  const header = rows[0].map(h => (h ?? "").replace(/^﻿/, "").trim());
  const body = rows.slice(1);

  const idx = {
    name: header.indexOf(COL.NAME),
    author: header.indexOf(COL.AUTHOR),
    type: header.indexOf(COL.TYPE),
    region: header.indexOf(COL.REGION),
    x: header.indexOf(COL.X),
    y: header.indexOf(COL.Y),
    z: header.indexOf(COL.Z),
    desc: header.indexOf(COL.DESC),
    tags: header.indexOf(COL.TAGS),
  };

  const val = (r, i) => (i >= 0 ? (r[i] ?? "") : "");

  return body.map((r) => {
    const tagsRaw = val(r, idx.tags).trim();
    return {
      name: val(r, idx.name).trim(),
      author: val(r, idx.author).trim(),
      type: val(r, idx.type).trim(),
      region: val(r, idx.region).trim(),
      x: toNumber(val(r, idx.x)),
      y: toNumber(val(r, idx.y)),
      z: toNumber(val(r, idx.z)),
      description: val(r, idx.desc).trim(),
      tags: tagsRaw ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean) : [],
    };
  });
}

/** セル文字列から数値へ。空や非数は null */
function toNumber(v) {
  const t = (v ?? "").toString().trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** ネザー座標に変換 */
function toNether(x, z) {
  if (x == null || z == null) return null;
  return { x: Math.round(x / 8), z: Math.round(z / 8) };
}

/** 汎用CSVパーサー */
function csvToRows(text) {
  const rows = []; let row = []; let cur = ""; let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } 
        else { inQuotes = false; }
      } else { cur += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(cur); cur = ""; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c !== '\r') { cur += c; }
    }
  }
  row.push(cur); rows.push(row);
  return rows.filter(r => !(r.length === 1 && r[0] === ""));
}

/** デバウンスユーティリティ */
function debounce(fn, wait = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/** フィルタとソートを適用して再描画 */
function applyFiltersAndSort() {
  const q = state.search.trim().toLocaleLowerCase();
  
  const filtered = state.data.filter((d) => {
    // 各フィルタのチェック
    if (state.author !== "__ALL__" && (d.author || UNSELECTED) !== state.author) return false;
    if (state.type !== "__ALL__" && (d.type || UNSELECTED) !== state.type) return false;
    if (state.region !== "__ALL__" && (d.region || UNSELECTED) !== state.region) return false;

    // キーワード検索
    if (!q) return true;
    const hay = `${d.name}\n${d.author}\n${d.description}\n${d.tags.join(" ")}`.toLocaleLowerCase();
    return hay.includes(q);
  });

  const cmpStr = (a, b) => a.localeCompare(b, 'ja', { sensitivity: 'base' });
  const cmpNumAsc = (a, b) => (a == null) - (b == null) || (a ?? 0) - (b ?? 0);
  const cmpNumDesc = (a, b) => (b == null) - (a == null) || (b ?? 0) - (a ?? 0);

  switch (state.sort) {
    case "nameAsc": filtered.sort((a, b) => cmpStr(a.name, b.name)); break;
    case "xAsc": filtered.sort((a, b) => cmpNumAsc(a.x, b.x)); break;
    case "zAsc": filtered.sort((a, b) => cmpNumAsc(a.z, b.z)); break;
    case "yAsc": filtered.sort((a, b) => cmpNumAsc(a.y, b.y)); break;
    case "yDesc": filtered.sort((a, b) => cmpNumDesc(a.y, b.y)); break;
  }

  state.filtered = filtered;
  renderCounts();
  if (state.view === "cards") {
    renderCards(filtered);
  } else {
    renderTable(filtered);
  }
}

/** 件数表示更新 */
function renderCounts() {
  el.counts.textContent = `${state.data.length}件中 ${state.filtered.length}件を表示`;
}

/** 空の値を「選択」に置き換えるヘルパー */
const getDisplay = (value) => value || UNSELECTED;

/** カード表示をレンダリング */
function renderCards(data) {
  el.cards.innerHTML = "";
  if (data.length === 0) {
    el.cards.innerHTML = `<div class="no-results">該当する施設はありません。</div>`;
    return;
  }
  for (const item of data) {
    const card = document.createElement("article");
    card.className = "card";

    const name = document.createElement("h2");
    name.className = "name";
    name.textContent = item.name || "(名称未設定)";

    const metaBadges = document.createElement("div");
    metaBadges.className = "meta-badges";
    metaBadges.innerHTML = `
      <span class="badge author-badge">${getDisplay(item.author)}</span>
      <span class="badge type-badge">${getDisplay(item.type)}</span>
      <span class="badge region-badge">${getDisplay(item.region)}</span>
    `;

    const coords = document.createElement("div");
    coords.className = "coords";
    const xyzText = [ `x:${item.x ?? '-'}`, `y:${item.y ?? '-'}`, `z:${item.z ?? '-'}`].join(" ");
    coords.innerHTML = `<span>${xyzText}</span>`;
    if (state.showNether) {
      const nz = toNether(item.x, item.z);
      if (nz) {
        coords.innerHTML += `<span class="nether">（ネザー x:${nz.x} z:${nz.z}）</span>`;
      }
    }
    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.type = "button";
    copyBtn.textContent = "コピー";
    copyBtn.addEventListener("click", () => {
      const text = [item.x, item.y, item.z].filter(v => v != null).join(" ");
      if (text) copyToClipboard(text);
    });
    coords.appendChild(copyBtn);

    const desc = document.createElement("p");
    desc.className = "desc";
    desc.textContent = item.description || "";

    const tags = document.createElement("div");
    tags.className = "tags";
    if (item.tags.length > 0) {
      tags.innerHTML = item.tags.map(t => `<span class="tag-chip">${t}</span>`).join("");
    }

    card.append(name, metaBadges, coords, desc, tags);
    el.cards.appendChild(card);
  }
}

/** テーブル表示をレンダリング */
function renderTable(data) {
  el.table.innerHTML = "";
  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");
  const headers = [
    { key: "name", label: COL.NAME }, { key: "author", label: COL.AUTHOR },
    { key: "type", label: COL.TYPE }, { key: "region", label: COL.REGION },
    { key: "x", label: COL.X }, { key: "y", label: COL.Y }, { key: "z", label: COL.Z },
    { key: "desc", label: COL.DESC }, { key: "tags", label: COL.TAGS },
  ];
  headers.forEach(h => {
    const th = document.createElement("th");
    th.textContent = h.label;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  const tbody = document.createElement("tbody");
  for (const item of data) {
    const tr = document.createElement("tr");
    const cells = [
      item.name, getDisplay(item.author), getDisplay(item.type), getDisplay(item.region),
      item.x, item.y, item.z, item.description, item.tags.join(", ")
    ];
    cells.forEach(val => {
      const td = document.createElement("td");
      td.textContent = val ?? "";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  el.table.append(thead, tbody);
}

/** クリップボードにコピーしてトースト表示 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("座標をコピーしました");
  } catch (e) {
    showToast("コピーに失敗しました");
  }
}

/** トースト表示 */
function showToast(message) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = message;
  el.toast.appendChild(t);
  setTimeout(() => {
    t.style.opacity = "0";
    setTimeout(() => t.remove(), 300);
  }, 2000);
}

/** フィルタの選択肢を生成・設定 */
function populateFilter(selectElement, data, key) {
  const set = new Set();
  data.forEach(d => set.add(d[key] || UNSELECTED));
  const options = Array.from(set).sort((a,b) => a.localeCompare(b, 'ja'));
  
  selectElement.innerHTML = '<option value="__ALL__">すべて</option>'; // Reset
  options.forEach(optValue => {
    const opt = document.createElement('option');
    opt.value = optValue;
    opt.textContent = optValue;
    selectElement.appendChild(opt);
  });
}

/** 最終更新時刻の描画 */
function renderLastUpdated() {
  if (!state.lastFetchedAt) return;
  el.lastUpdated.textContent = `最終更新: ${state.lastFetchedAt.toLocaleString('ja-JP')}`;
}

/** スケルトン表示 */
function renderSkeleton(count = 6) {
  el.cards.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const card = document.createElement("article");
    card.className = "card skeleton";
    card.innerHTML = `
      <div class="skeleton-line" style="width: 80%; height: 24px;"></div>
      <div class="skeleton-line" style="width: 50%;"></div>
      <div class="skeleton-line" style="width: 70%;"></div>
      <div class="skeleton-line" style="width: 90%; height: 40px;"></div>
    `;
    el.cards.appendChild(card);
  }
}

/** エラー表示の切替 */
function showError(show) {
  el.errorPanel.hidden = !show;
}

/** イベント初期化 */
function initEvents() {
  el.search.addEventListener("input", debounce(e => {
    state.search = e.target.value || "";
    applyFiltersAndSort();
  }));

  el.authorFilter.addEventListener("change", e => { state.author = e.target.value; applyFiltersAndSort(); });
  el.typeFilter.addEventListener("change", e => { state.type = e.target.value; applyFiltersAndSort(); });
  el.regionFilter.addEventListener("change", e => { state.region = e.target.value; applyFiltersAndSort(); });
  el.sortSelect.addEventListener("change", e => { state.sort = e.target.value; applyFiltersAndSort(); });
  el.netherToggle.addEventListener("change", e => { state.showNether = !!e.target.checked; applyFiltersAndSort(); });

  const selectTab = (view) => {
    state.view = view;
    el.tabCards.setAttribute("aria-selected", view === "cards");
    el.tabTable.setAttribute("aria-selected", view === "table");
    el.cards.hidden = view !== "cards";
    el.tableWrapper.hidden = view !== "table";
    applyFiltersAndSort();
  };
  el.tabCards.addEventListener("click", () => selectTab("cards"));
  el.tabTable.addEventListener("click", () => selectTab("table"));

  el.retryBtn.addEventListener("click", () => start());
}

/** アプリ開始 */
async function start() {
  try {
    showError(false);
    if (state.view !== 'cards') {
      el.tabCards.click();
    }
    renderSkeleton();
    const csv = await fetchCsv(CSV_URL);
    const parsed = parseCsv(csv).filter(row => Object.values(row).some(v => v != null && v.length !== 0));
    state.data = parsed;
    
    populateFilter(el.authorFilter, parsed, 'author');
    populateFilter(el.typeFilter, parsed, 'type');
    populateFilter(el.regionFilter, parsed, 'region');

    renderLastUpdated();
    applyFiltersAndSort();
  } catch (e) {
    console.error(e);
    el.cards.innerHTML = "";
    showError(true);
  }
}

// 初期化
initEvents();
start();