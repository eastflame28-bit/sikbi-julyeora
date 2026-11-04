// 식비를 줄여라 — 화면과 동작

import { icon } from "./icons.js";
import { ALL_NAMES, BASICS, SUGGEST, norm } from "./catalog.js";
import { openStore, signInWithGoogle, signOut, supabase, uid } from "./store.js";
import { annotate, findRecipes, markRecipe, newId, shareRecipes } from "./pool.js";
import { aiRecipes, connectGemini, disconnectGemini, geminiInfo, isYoutubeUrl, modelLabel, videoRecipe } from "./gemini.js";
import { SEED_RECIPES } from "./seed-recipes.js";
import { config } from "./config.js";
import { SUBSTITUTES, SUB_CATS, availableOptions } from "./subs.js";

const $ = (sel, root = document) => root.querySelector(sel);
const main = $("#main");
const tabbar = $("#tabbar");
const topbar = $("#topbar");
const overlayRoot = $("#overlay-root");

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const won = (n) => "₩" + Math.round(n).toLocaleString("ko-KR");
const fmtDate = (t) => new Date(t).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });

const DIFF = { easy: "쉬움", medium: "보통", hard: "어려움" };
const TABS = [
  { id: "find", label: "요리 찾기", icon: "search" },
  { id: "my", label: "내 레시피", icon: "book" },
  { id: "settings", label: "설정", icon: "gear" },
];
const KEY_URL = "https://aistudio.google.com/apikey";
const CATS = ["밥·면", "국·찌개", "반찬", "메인", "전"];
const COMMON_BASICS = ["소금", "설탕", "식용유", "진간장", "참기름", "다진마늘", "후추", "고춧가루"];

const state = {
  store: null,
  data: null,
  storeError: null,
  route: { name: "", param: "" },
  searched: false,
  results: null,
  resultsKey: "",
  searching: false,
  searchError: null,
  ai: { loading: false, error: null, list: [] },
  key: { open: false, checking: false, error: null, just: false },
  cache: new Map(),
  myFilter: "all",
  cat: "all",
  more: {},
  video: { loading: false, error: null, draft: null, url: "" },
  recipeLoading: null,
};

// ───────── 공통 ─────────

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;
}

const profile = () => state.data.profile;
const pantry = () => state.data.pantry;
const signedIn = () => state.store.mode === "cloud";

async function saveProfile(patch) {
  const next = { ...profile(), ...patch };
  state.data.profile = next;
  try { await state.store.saveProfile(next); } catch (e) { console.error(e); toast("저장하지 못했어요. 잠시 후 다시 시도해 주세요."); }
}

async function savePantry(list) {
  state.data.pantry = list;
  render();
  try { await state.store.savePantry(list); } catch (e) { console.error(e); toast("저장하지 못했어요. 잠시 후 다시 시도해 주세요."); }
}

function findRecipe(id) {
  return state.cache.get(id)
    || state.data.recipes.find((r) => r.id === id)
    || SEED_RECIPES.find((r) => r.id === id)
    || null;
}

// 새로고침해도 방금 받은 레시피(특히 AI 레시피)가 사라지지 않도록 탭이 열려 있는 동안 보관
const CACHE_KEY = "sikbi:cache2";
function cacheRecipe(r) {
  const { have, missing, swaps, mainUsed, ...plain } = r;
  plain.ingredients = r.ingredients.map(({ have: _h, swap: _s, ...i }) => i);
  state.cache.set(r.id, plain);
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify([...state.cache.values()].slice(-60))); } catch { /* 무시 */ }
}
function restoreCache() {
  try { for (const r of JSON.parse(sessionStorage.getItem(CACHE_KEY) || "[]")) state.cache.set(r.id, r); } catch { /* 무시 */ }
}

const savedVersion = (id) => state.data.recipes.find((r) => r.id === id) || null;

async function upsertSaved(recipe, patch) {
  const base = savedVersion(recipe.id) || stripForSave(recipe);
  const next = { ...base, ...patch, updatedAt: Date.now() };
  const keep = next.favorite || next.notes?.length || next.source === "video";
  try {
    if (keep) await state.store.putRecipe(next);
    else await state.store.removeRecipe(recipe.id);
  } catch (e) {
    console.error(e);
    toast("저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
  return next;
}

// 저장할 때는 화면용 계산값(have, missing 등)을 빼고 원래 레시피만 남긴다
function stripForSave(r) {
  return {
    id: r.id, title: r.title, emoji: r.emoji || "🍽️", category: r.category || "", summary: r.summary || "",
    total_minutes: r.total_minutes, difficulty: r.difficulty, servings: r.servings,
    equipment: r.equipment || [], source: r.source, videoUrl: r.videoUrl || null,
    ingredients: r.ingredients.map(({ name, amount, optional, substitute }) => ({ name, amount: amount ?? "", optional: !!optional, substitute: substitute ?? null })),
    steps: r.steps || [], favorite: false, notes: [], createdAt: Date.now(),
  };
}

function myNotes() {
  return state.data.recipes.filter((r) => r.notes?.length).slice(0, 5).map((r) => ({ title: r.title, note: r.notes[0].text }));
}

// ───────── 라우터 ─────────

function parseRoute() {
  const [name = "", param = ""] = location.hash.replace(/^#\/?/, "").split("/");
  return { name: name || "find", param: decodeURIComponent(param) };
}

function go(path) {
  if (location.hash === "#/" + path) render();
  else location.hash = "#/" + path;
}

window.addEventListener("hashchange", () => {
  const prev = state.route.name;
  state.route = parseRoute();
  closeOverlay();
  render({ focusMain: true });
  if (prev !== state.route.name) window.scrollTo(0, 0);
});

// ───────── 렌더링 ─────────

function render({ focusMain = false } = {}) {
  if (!state.data) return; // 아직 불러오는 중 (시작할 때 다시 그린다)
  const active = document.activeElement;
  const key = active?.dataset?.key;

  const r = state.route;
  const views = { find: viewFind, recipe: viewRecipe, my: viewMy, settings: viewSettings, subs: viewSubs };
  const view = views[r.name] || viewFind;

  renderTopbar();
  renderTabbar(r.name === "recipe" || r.name === "subs" ? (state.lastTab || "find") : r.name);
  if (TABS.some((t) => t.id === r.name)) state.lastTab = r.name;

  main.innerHTML = `<div class="inner">${banners()}${view(r.param)}</div>`;
  if (r.name === "find") ensureResults();
  if (r.name === "recipe") ensureRecipe(r.param);

  if (key) {
    const again = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (again) { again.focus({ preventScroll: true }); return; }
  }
  if (focusMain) main.focus({ preventScroll: true });
}

function renderTabbar(current) {
  tabbar.innerHTML = `
    <div class="brand-mini"><img src="assets/logo.svg" alt="">식비를 줄여라</div>
    ${TABS.map((t, i) => `
      <a class="tab" href="#/${t.id}" ${t.id === current ? 'aria-current="page"' : ""}>
        ${icon(t.icon)}<span>${t.label}</span><span class="kbd" aria-hidden="true">${i + 1}</span>
      </a>`).join("")}`;
}

function banners() {
  if (!state.storeError) return "";
  return `<div class="banner" role="alert">${icon("alert")}<span>클라우드에 연결하지 못해 <b>이 기기에 임시 저장</b>하고 있어요. 인터넷 연결을 확인해 주세요.</span></div>`;
}

// ───────── 위쪽 바: AI 연결 ─────────

function renderTopbar() {
  const info = geminiInfo();
  const k = state.key;
  topbar.innerHTML = `
    <div class="topbar-row">
      <a class="brand" href="#/find" aria-label="식비를 줄여라 처음 화면"><img src="assets/logo.svg" alt="">식비를 줄여라</a>
      <button class="ai-pill ${info ? "on" : ""}" data-act="ai-toggle" data-key="ai-toggle" aria-expanded="${k.open}" aria-controls="ai-panel">
        <span class="dot" aria-hidden="true"></span>${info ? "AI 연결됨" : "AI 설정"}
      </button>
    </div>
    ${k.open ? `<section class="ai-panel" id="ai-panel" aria-labelledby="ai-panel-t">
      ${info ? `
        <h2 id="ai-panel-t">${k.just ? `${icon("check")} 연결 성공` : "제미나이 연결됨"}</h2>
        <p class="muted small">사용 모델: <b>${esc(modelLabel(info.model))}</b> · 내 재료에 맞춘 새 요리와 영상 정리를 쓸 수 있어요.</p>
        <div class="row">
          <button class="btn btn-ghost btn-sm" data-act="ai-disconnect" data-key="ai-disconnect">연결 끊기</button>
          <button class="btn btn-ghost btn-sm" data-act="ai-toggle" data-key="ai-close">닫기</button>
        </div>
        <p class="fine">키는 이 기기 브라우저에만 저장돼요. 공용 컴퓨터라면 다 쓴 뒤 '연결 끊기'를 눌러 주세요.</p>
      ` : `
        <h2 id="ai-panel-t">${icon("key")} 제미나이 API 키 연결</h2>
        <p class="muted small">키가 없어도 기본 레시피로 찾을 수 있어요. 키를 넣으면 AI가 내 재료에 맞춘 요리를 더 찾아 줘요.</p>
        <label class="sr-only" for="key-input">제미나이 API 키</label>
        <div class="add-row">
          <input class="input" id="key-input" data-key="key-input" type="password" autocomplete="off" spellcheck="false" placeholder="AI Studio에서 복사한 키 붙여 넣기" data-enter="ai-connect" ${k.checking ? "disabled" : ""}>
          <button class="btn btn-primary" data-act="ai-connect" data-key="ai-connect" ${k.checking ? "disabled" : ""}>${k.checking ? "확인 중…" : "연결"}</button>
        </div>
        ${k.error ? `<p class="err" role="alert">${icon("alert")}${esc(k.error)}</p>` : ""}
        <a class="link" href="${KEY_URL}" target="_blank" rel="noopener">키 받는 곳: Google AI Studio (새 창) ↗</a>
        <p class="fine">키는 이 기기 브라우저에만 저장되고 우리 서버로는 보내지 않아요. 무료 키로 보낸 재료 목록은 구글이 AI 개선에 쓸 수 있어요.</p>
      `}
    </section>` : ""}`;
}

function openKeyPanel() {
  state.key.open = true;
  state.key.just = false;
  renderTopbar();
  setTimeout(() => ($("#key-input") || $('[data-key="ai-disconnect"]'))?.focus(), 0);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeKeyPanel() {
  state.key.open = false;
  state.key.error = null;
  renderTopbar();
  $('[data-key="ai-toggle"]')?.focus();
}

async function connectKey() {
  const input = $("#key-input");
  state.key.checking = true;
  state.key.error = null;
  const value = input?.value;
  renderTopbar();
  try {
    await connectGemini(value);
    state.key.just = true;
    toast("제미나이 연결에 성공했어요");
  } catch (e) {
    state.key.error = e.message;
  } finally {
    state.key.checking = false;
    render();
    if (state.key.error) { const el = $("#key-input"); if (el) { el.value = value || ""; el.focus(); } }
    else $('[data-key="ai-disconnect"]')?.focus();
  }
}

// ───────── 요리 찾기 ─────────

function viewFind() {
  const list = pantry();
  const have = new Set(list.map((p) => norm(p.name)));
  const suggest = SUGGEST.filter((n) => !have.has(n)).slice(0, 5);
  const basicsOn = BASICS.filter((n) => have.has(n));
  const fridge = list.filter((p) => !BASICS.includes(norm(p.name)));

  return `
  <header class="find-head">
    <h1 class="page-title">냉장고에 뭐가 있나요?</h1>
  </header>

  <div class="field">
    <label for="pantry-input">가지고 있는 재료</label>
    <div class="add-row">
      <input class="input input-lg" id="pantry-input" data-key="pantry-input" list="names" autocomplete="off" enterkeyhint="done" placeholder="예: 계란, 양파" data-enter="add-pantry">
      <button class="btn btn-ghost" data-act="add-pantry" data-key="add-pantry">${icon("plus")} 추가</button>
    </div>
    <p class="hint-line">쉼표나 <kbd>Enter</kbd>로 여러 개를 넣을 수 있어요</p>
  </div>
  <datalist id="names">${ALL_NAMES.map((n) => `<option value="${n}">`).join("")}</datalist>

  ${fridge.length ? `<div class="chips mine" aria-label="넣은 재료">
    ${fridge.map((p) => `<button class="chip on" data-act="del-pantry" data-v="${esc(p.name)}" data-key="del-${esc(p.name)}" aria-label="${esc(p.name)} 삭제">${esc(p.name)} ${icon("x", "x")}</button>`).join("")}
    ${fridge.length >= 3 ? `<button class="chip ghost" data-act="clear-pantry" data-key="clear-pantry">모두 지우기</button>` : ""}
  </div>` : ""}

  ${suggest.length ? `<div class="suggest">
    <span class="muted small">자주 쓰는 재료</span>
    <div class="chips">${suggest.map((n) => `<button class="chip" data-act="add-one" data-v="${n}" data-key="sug-${n}" aria-label="${n} 추가">${icon("plus")}${n}</button>`).join("")}</div>
  </div>` : ""}

  <details class="basics ${basicsOn.length ? "" : "nudge"}" ${(state.basicsOpen ?? !basicsOn.length) ? "open" : ""} data-key="basics">
    <summary data-act="basics-toggle">
      <span><b>기본 양념</b> ${basicsOn.length ? `<span class="muted">${basicsOn.length}개 있음</span>` : `<span class="warn-text">아직 안 골랐어요 · 고르면 만들 수 있는 요리가 크게 늘어요</span>`}</span>
      ${icon("next", "chev")}
    </summary>
    <div class="chips">
      ${!basicsOn.length ? `<button class="chip ghost strong" data-act="basics-common" data-key="basics-common">${icon("check")}흔한 양념 한 번에 고르기</button>` : ""}
      ${BASICS.map((n) => `<button class="chip" data-act="toggle-basic" data-v="${n}" data-key="basic-${n}" aria-pressed="${have.has(n)}">${have.has(n) ? icon("check") : ""}${n}</button>`).join("")}
    </div>
  </details>

  <p class="subs-link"><a class="link" href="#/subs" data-key="to-subs">${icon("leaf")} 재료가 없을 때 대신 쓰는 법</a></p>

  <button class="btn btn-primary btn-block btn-lg" data-act="search" data-key="search" ${list.length ? "" : "disabled"}>${icon("search")} 요리 찾기</button>
  ${!list.length ? `<p class="hint-line center">재료를 하나 이상 넣어 주세요</p>` : ""}

  <div id="results" aria-live="polite">${resultsHtml()}</div>`;
}

function resultsHtml() {
  if (!state.searched || !pantry().length) return "";
  if (state.searching && !state.results) return `<div class="loading small-loading"><img src="assets/cooking.svg" alt=""><p>레시피를 찾고 있어요…</p></div>`;
  if (state.searchError) {
    return `<div class="empty"><h2>레시피를 불러오지 못했어요</h2><p>${esc(state.searchError)}</p>
      <button class="btn btn-primary" data-act="search" data-key="retry">다시 시도</button></div>`;
  }
  const res = state.results;
  if (!res) return "";
  const ai = state.ai;
  const allAi = ai.list.map((r) => annotate(r, pantry()));
  const all = [...allAi, ...res.ready, ...res.almost];
  const cats = CATS.map((c) => [c, all.filter((r) => r.category === c).length]).filter(([, n]) => n);
  if (state.cat !== "all" && !cats.some(([c]) => c === state.cat)) state.cat = "all";
  const pick = (l) => (state.cat === "all" ? l : l.filter((r) => r.category === state.cat));
  const aiList = pick(allAi), ready = pick(res.ready), almost = pick(res.almost);
  const none = !ready.length && !almost.length && !aiList.length;

  return `
    <h2 class="sr-only" id="results-t" tabindex="-1">검색 결과</h2>
    ${cats.length > 1 ? `<div class="cat-row" role="group" aria-label="요리 종류">
      <button class="chip" data-act="cat" data-v="all" data-key="cat-all" aria-pressed="${state.cat === "all"}">전체 ${all.length}</button>
      ${cats.map(([c, n]) => `<button class="chip" data-act="cat" data-v="${c}" data-key="cat-${c}" aria-pressed="${state.cat === c}">${c} ${n}</button>`).join("")}
    </div>` : ""}
    ${aiList.length ? group("ai-t", "sparkle", "AI가 새로 찾은 요리", aiList, "ai") : ""}
    ${ready.length ? group("ready-t", "check", "지금 만들 수 있는 요리", ready, "ready") : ""}
    ${almost.length ? group("almost-t", "cart", "재료 1~2개만 더 있으면", almost, "almost") : ""}
    ${none ? `<div class="empty">
      <img src="assets/empty-recipes.svg" alt="">
      <h2>맞는 요리를 찾지 못했어요</h2>
      <p>재료를 몇 가지 더 넣거나 기본 양념을 골라 보세요.${geminiInfo() ? " AI에게 물어볼 수도 있어요." : ""}</p>
    </div>` : ""}
    ${aiBox()}`;
}

// 처음에는 몇 개만 보여 주고 '더 보기'로 늘린다
const FIRST = { ai: 6, ready: 9, almost: 6 };
function group(id, ic, title, list, key) {
  const limit = state.more[key] || FIRST[key];
  const rest = list.length - limit;
  return `<section class="section" aria-labelledby="${id}">
    <h2 class="section-title" id="${id}" tabindex="-1">${icon(ic)} ${title} <span class="count">${list.length}개</span></h2>
    <div class="recipe-grid">${list.slice(0, limit).map(cardHtml).join("")}</div>
    ${rest > 0 ? `<button class="btn btn-ghost btn-block more-btn" data-act="more" data-v="${key}" data-key="more-${key}">더 보기 (${rest}개 더 있어요)</button>` : ""}
  </section>`;
}

function aiBox() {
  const ai = state.ai;
  if (!geminiInfo()) {
    return `<div class="ai-box">
      <p><b>더 많은 요리를 보고 싶다면</b><br><span class="muted">AI를 연결하면 내 재료에 맞춘 새 요리를 찾아 드려요.</span></p>
      <button class="btn btn-ghost" data-act="ai-open" data-key="ai-open">${icon("key")} AI 연결하기</button>
    </div>`;
  }
  if (ai.loading) {
    const sec = Math.round((Date.now() - ai.startedAt) / 1000);
    return `<div class="loading small-loading ai-wait"><img src="assets/cooking.svg" alt="">
      <p><b>AI가 내 재료로 만들 요리를 찾고 있어요</b> <span class="elapsed" id="ai-elapsed">${sec}초</span></p>
      <p class="muted small" id="ai-status">${esc(ai.status || "레시피 3가지를 조리 순서까지 쓰고 있어요. 보통 30초~1분 걸려요.")}</p>
    </div>`;
  }
  return `<div class="ai-box">
    ${ai.error ? `<p class="err" role="alert">${icon("alert")}${esc(ai.error)}</p>` : `<p><b>마음에 드는 요리가 없나요?</b><br><span class="muted">AI가 내 재료를 보고 새 요리 3가지를 찾아 드려요.</span></p>`}
    <button class="btn btn-ghost" data-act="ai-search" data-key="ai-search">${icon("sparkle")} ${ai.error ? "다시 시도" : "AI로 더 찾기"}</button>
  </div>`;
}

function sourceLabel(r) {
  const cooks = r.stats?.cooks || 0;
  if (r.source === "video") return `<span class="src">${icon("video")}영상에서 정리</span>`;
  if (cooks > 0) return `<span class="src ok">${icon("check")}${cooks}명이 만들어 봤어요</span>`;
  if (r.source === "ai") return `<span class="src">${icon("sparkle")}AI 생성 · 확인 전</span>`;
  return `<span class="src">기본 레시피</span>`;
}

function cardHtml(r, idx = 0) {
  const saved = savedVersion(r.id);
  return `<a class="rcard" href="#/recipe/${encodeURIComponent(r.id)}" data-key="card-${esc(r.id)}" style="animation-delay:${Math.min(idx, 6) * 30}ms">
    <span class="thumb" aria-hidden="true">${esc(r.emoji || "🍽️")}</span>
    <span class="body">
      <h3>${esc(r.title)}${saved?.favorite ? `<span class="sr-only"> (즐겨찾기)</span>${icon("star", "fav")}` : ""}</h3>
      <span class="meta">${r.total_minutes ? `${r.total_minutes}분 · ` : ""}${DIFF[r.difficulty] || "쉬움"}</span>
      ${r.missing?.length ? `<span class="need">${icon("cart")}${r.missing.map(esc).join(", ")}만 더 필요</span>` : ""}
      ${r.swaps?.length ? `<span class="swapline">${icon("leaf")}${r.swaps.slice(0, 2).map((w) => `${esc(w.name)} 대신 ${esc(w.use.join("+"))}`).join(", ")}</span>` : ""}
      ${sourceLabel(r)}
    </span>
  </a>`;
}

let searchTimer;
function ensureResults(force = false) {
  if (!state.searched || !pantry().length) return;
  const key = JSON.stringify([pantry().map((x) => x.name).sort(), profile().excluded]);
  if (!force && state.resultsKey === key) return;
  state.resultsKey = key;
  state.searching = true;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(key), 120);
}

async function runSearch(key) {
  state.searching = true;
  state.searchError = null;
  try {
    const res = await findRecipes({ pantry: pantry(), excluded: profile().excluded, extra: [...state.cache.values()].filter((r) => r.source === "ai") });
    if (state.resultsKey !== key) return;
    state.results = res;
    state.more = {};
  } catch (e) {
    console.error(e);
    state.searchError = "인터넷 연결을 확인하고 다시 시도해 주세요.";
    state.resultsKey = "";
  } finally {
    state.searching = false;
    updateResults();
  }
}

function updateResults() {
  const box = $("#results");
  if (box && state.route.name === "find") {
    const key = document.activeElement?.dataset?.key;
    box.innerHTML = resultsHtml();
    if (key) box.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }
}

async function runAi() {
  const ai = state.ai;
  ai.loading = true;
  ai.error = null;
  ai.status = "";
  ai.startedAt = Date.now();
  updateResults();
  // 기다리는 동안 몇 초 지났는지 보여 줘서 멈춘 게 아니라는 걸 알린다
  const tick = setInterval(() => {
    const el = $("#ai-elapsed");
    if (el) el.textContent = `${Math.round((Date.now() - ai.startedAt) / 1000)}초`;
  }, 1000);
  try {
    const shown = [...ai.list, ...(state.results?.ready || []), ...(state.results?.almost || [])].map((r) => r.title);
    const out = await aiRecipes({ pantry: pantry(), excluded: profile().excluded, servings: profile().servings, notes: myNotes(), avoid: shown,
      onStatus: (msg) => { ai.status = msg; const el = $("#ai-status"); if (el) el.textContent = msg; } });
    if (out.status !== "ok") { ai.error = out.message || "가진 재료로 만들 만한 새 요리를 찾지 못했어요."; return; }
    const list = out.recipes.map((r) => ({ ...r, id: newId("ai"), source: "ai" }));
    list.forEach(cacheRecipe);
    ai.list = [...list, ...ai.list];
    shareRecipes(list).then((ok) => { if (ok) toast("AI가 찾은 요리를 모두의 레시피 창고에 보탰어요"); });
  } catch (e) {
    console.error(e);
    ai.error = e.message || "AI 추천을 받지 못했어요.";
    if (e.code === "invalid" || e.code === "denied") { disconnectGemini(); renderTopbar(); }
  } finally {
    clearInterval(tick);
    ai.loading = false;
    updateResults();
    $(ai.error ? '[data-key="ai-search"]' : "#ai-t")?.focus?.();
  }
}

function addPantry(text) {
  const names = String(text).split(/[,，、]/).map((s) => s.trim()).filter(Boolean).map((s) => s.slice(0, 20));
  if (!names.length) return 0;
  const have = new Set(pantry().map((p) => norm(p.name)));
  const add = [...new Set(names)].filter((n) => !have.has(norm(n)));
  if (add.length) savePantry([...pantry(), ...add.map((name) => ({ name }))]);
  return add.length;
}

function addPantryFromInput() {
  const input = $("#pantry-input");
  if (!input) return;
  if (!input.value.trim()) { input.focus(); return; }
  const n = addPantry(input.value);
  input.value = "";
  $("#pantry-input")?.focus();
  if (!n) toast("이미 넣은 재료예요");
}

// ───────── 레시피 ─────────

function viewRecipe(id) {
  let r = findRecipe(id);
  if (!r) {
    if (state.recipeLoading === id) return `<div class="loading"><img src="assets/cooking.svg" alt=""><p>레시피를 불러오는 중…</p></div>`;
    return `<div class="empty">
      <img src="assets/empty-recipes.svg" alt="">
      <h2>레시피를 찾을 수 없어요</h2>
      <p>요리 찾기에서 다시 골라 주세요.</p>
      <a class="btn btn-primary" href="#/find">요리 찾기로 가기</a>
    </div>`;
  }
  r = annotate(r, pantry());
  const saved = savedVersion(r.id);
  const notes = saved?.notes || [];
  const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(r.title + " 레시피")}`;

  return `
  <div class="back-row">
    <button class="icon-btn" data-act="back" data-key="back" aria-label="뒤로 가기">${icon("back")}</button>
    <button class="icon-btn ${saved?.favorite ? "on" : ""}" data-act="fav" data-v="${esc(r.id)}" data-key="fav" aria-pressed="${!!saved?.favorite}" aria-label="즐겨찾기">${icon("star")}</button>
  </div>

  <header class="recipe-hero">
    <span class="thumb" aria-hidden="true">${esc(r.emoji || "🍽️")}</span>
    <div>
      <h1>${esc(r.title)}</h1>
      <p class="meta">${r.total_minutes ? `${r.total_minutes}분 · ` : ""}${r.servings || profile().servings}인분 · ${DIFF[r.difficulty] || "쉬움"}</p>
      ${sourceLabel(r)}
    </div>
  </header>
  ${r.summary ? `<p class="summary">${esc(r.summary)}</p>` : ""}

  ${notes.length ? `<div class="banner info">${icon("edit")}<span><b>지난번 내 메모</b> · ${esc(notes[0].text)}</span></div>` : ""}

  <div class="recipe-body">
    <aside class="aside">
      <section class="card" aria-labelledby="ing-t">
        <h2 class="section-title" id="ing-t">재료 <span class="count">${r.ingredients.filter((x) => x.have).length}/${r.ingredients.length} 있음</span></h2>
        ${r.missing.length ? `<p class="need-line">${icon("cart")}<span><b>${r.missing.map(esc).join(", ")}</b>만 있으면 바로 만들 수 있어요</span></p>` : ""}
        ${r.swaps.length ? `<p class="swap-line">${icon("leaf")}<span>없는 재료 ${r.swaps.length}개는 <b>집에 있는 재료로 대신</b>할 수 있어요</span></p>` : ""}
        <ul class="ing-list">
          ${r.ingredients.map((x) => `<li class="${x.have ? "have" : x.swap ? "swap" : "miss"}">
            <span class="dot">${x.have ? icon("check") : x.swap ? icon("leaf") : icon("cart")}</span>
            <span class="name">${esc(x.name)}${x.optional ? ` <span class="opt">(없어도 돼요)</span>` : ""}
              ${x.swap ? `<span class="sub">대신 ${esc(x.swap.use.join(" + "))}: ${esc(x.swap.how)}</span>` : !x.have && x.substitute ? `<span class="sub">대신: ${esc(x.substitute)}</span>` : ""}</span>
            <span class="qty ${x.amount === "확인 필요" ? "check-need" : ""}">${esc(x.amount || "")}</span>
            <span class="sr-only">${x.have ? "있음" : x.swap ? "대신 쓸 수 있음" : "없음"}</span>
          </li>`).join("")}
        </ul>
        <p class="subs-link"><a class="link" href="#/subs" data-key="recipe-subs">${icon("leaf")} 대체 재료 사전 보기</a></p>
      </section>
      ${r.steps?.length ? `<button class="btn btn-primary btn-block btn-lg" data-act="cook" data-v="${esc(r.id)}" data-key="cook">${icon("play")} 요리 시작</button>` : ""}
    </aside>

    <section aria-labelledby="steps-t">
      <h2 class="section-title" id="steps-t">만드는 순서 <span class="count">${r.steps.length}단계</span></h2>
      <ol class="steps">${r.steps.map(stepHtml).join("")}</ol>

      <div class="link-row">
        <a class="btn btn-ghost" href="${r.videoUrl ? esc(r.videoUrl) : yt}" target="_blank" rel="noopener" data-key="yt">${icon("video")} ${r.videoUrl ? "원본 영상 보기" : "유튜브에서 영상 보기"} <span class="sr-only">(새 창)</span></a>
      </div>

      <section class="card note-card" aria-labelledby="note-t">
        <h2 class="section-title" id="note-t">${icon("edit")} 이렇게 했더니 맛있더라</h2>
        <p class="muted small">바꾼 양념이나 요령을 적어 두면 나만의 레시피가 돼요.${geminiInfo() ? " AI가 다음 추천 때 참고해요." : ""}</p>
        <label class="sr-only" for="note-input">메모</label>
        <textarea class="textarea" id="note-input" data-key="note-input" placeholder="예: 설탕 대신 올리고당 1큰술, 양파를 더 넣으니 달달했다"></textarea>
        <div class="note-actions">
          <span class="muted small kbd-hint" aria-hidden="true"><kbd>Ctrl</kbd> + <kbd>Enter</kbd></span>
          <button class="btn btn-ghost" data-act="save-note" data-v="${esc(r.id)}" data-key="save-note">메모 저장</button>
        </div>
        ${notes.length ? `<ul class="note-list">${notes.map((n) => `<li><time>${fmtDate(n.date)}</time>${esc(n.text)}</li>`).join("")}</ul>` : ""}
      </section>

      ${r.source === "ai" ? `<p class="ai-note">${icon("info")}AI가 만든 레시피예요. 간과 익힘 정도는 직접 확인해 주세요.</p>` : ""}
      ${r.source === "video" ? `<p class="ai-note">${icon("info")}영상을 AI가 정리했어요. 양과 순서가 영상과 다를 수 있어요.</p>` : ""}
    </section>
  </div>`;
}

function stepHtml(s, i) {
  return `<li class="step">
    <span class="no" aria-hidden="true">${i + 1}</span>
    <div>
      <h3><span class="sr-only">${i + 1}단계. </span>${esc(s.title)}</h3>
      <p>${esc(s.instruction)}</p>
      ${s.heat || s.timer_seconds ? `<span class="heat">${s.heat ? `${icon("flame")}${esc(s.heat)}` : ""}${s.timer_seconds ? ` ${icon("timer")}약 ${Math.round(s.timer_seconds / 60) || 1}분` : ""}</span>` : ""}
      ${s.done_when ? `<div class="done-when">${icon("check")}<span><b>다음으로 넘어갈 때</b> · ${esc(s.done_when)}</span></div>` : ""}
      ${s.tip ? `<div class="tip">${icon("bulb")}<span>${esc(s.tip)}</span></div>` : ""}
    </div>
  </li>`;
}

// 공용 창고의 레시피를 새로고침 뒤 바로 열었을 때 Supabase에서 한 번 더 찾아본다
async function ensureRecipe(id) {
  if (findRecipe(id) || state.recipeLoading === id || state.recipeMissing === id) return;
  const sb = await supabase();
  if (!sb) return;
  state.recipeLoading = id;
  render();
  try {
    const { data } = await sb.from("recipes").select("*").eq("id", id).maybeSingle();
    if (data) cacheRecipe({ ...data, source: "ai" });
    else state.recipeMissing = id;
  } catch (e) {
    console.error(e);
    state.recipeMissing = id;
  } finally {
    state.recipeLoading = null;
    if (state.route.name === "recipe" && state.route.param === id) render();
  }
}

// ───────── 대체 재료 사전 ─────────

function viewSubs() {
  return `
  <div class="back-row">
    <button class="icon-btn" data-act="back" data-key="back" aria-label="뒤로 가기">${icon("back")}</button>
  </div>
  <header class="page-head"><div>
    <h1 class="page-title">대신 쓸 수 있는 재료</h1>
    <p class="page-sub">재료가 없을 때 집에 있는 것으로 바꾸는 방법과 비율이에요. 내 재료로 가능한 방법에는 <b>집에 있어요</b>가 붙어요.</p>
  </div></header>
  <label class="sr-only" for="subs-input">재료 이름으로 찾기</label>
  <div class="search-wrap">${icon("search")}<input class="input input-lg" id="subs-input" data-key="subs-input" type="search" autocomplete="off" placeholder="예: 맛술, 굴소스, 버터" value="${esc(state.subsQuery || "")}"></div>
  <div id="subs-list" aria-live="polite">${subsListHtml()}</div>`;
}

function subsListHtml() {
  const q = norm(state.subsQuery || "");
  const names = pantry().map((p) => norm(p.name));
  const hit = (x) => !q || norm(x.need).includes(q) || x.options.some((op) => op.use.some((u) => norm(u).includes(q)));
  const groups = SUB_CATS.map((cat) => [cat, SUBSTITUTES.filter((x) => x.cat === cat && hit(x))]).filter(([, l]) => l.length);
  if (!groups.length) return `<div class="empty"><h2>찾는 재료가 사전에 없어요</h2><p>AI를 연결하면 레시피마다 대체 재료를 함께 알려 드려요.</p></div>`;
  return groups.map(([cat, list]) => `<section class="section" aria-label="${cat}">
    <h2 class="section-title">${cat}</h2>
    <div class="subs-grid">${list.map((x) => `<div class="card sub-card">
      <h3>${esc(x.need)} <span class="muted">없을 때</span></h3>
      <ul>${availableOptions(x, names).map((op) => `<li class="${op.ok ? "ok" : ""}">
        <span class="use">${esc(op.use.join(" + "))}${op.ok ? ` <span class="badge">집에 있어요</span>` : ""}</span>
        <span class="how">${esc(op.how)}</span>${op.note ? `<span class="note">${esc(op.note)}</span>` : ""}
      </li>`).join("")}</ul>
    </div>`).join("")}</div>
  </section>`).join("");
}

document.addEventListener("input", (e) => {
  if (e.target.id !== "subs-input") return;
  state.subsQuery = e.target.value;
  const box = $("#subs-list");
  if (box) box.innerHTML = subsListHtml();
});

// ───────── 요리 모드 ─────────

const cook = { recipe: null, i: 0, left: 0, running: false, tick: null };

function openCook(id) {
  const r = findRecipe(id);
  if (!r?.steps?.length) return;
  Object.assign(cook, { recipe: r, i: 0 });
  resetTimer();
  renderCook();
}

function resetTimer() {
  clearInterval(cook.tick);
  cook.running = false;
  cook.left = cook.recipe.steps[cook.i]?.timer_seconds || 0;
}

function renderCook() {
  const r = cook.recipe;
  const s = r.steps[cook.i];
  const last = cook.i === r.steps.length - 1;
  const mm = String(Math.floor(cook.left / 60)).padStart(2, "0");
  const ss = String(cook.left % 60).padStart(2, "0");
  overlayRoot.innerHTML = `
  <div class="cook" role="dialog" aria-modal="true" aria-labelledby="cook-t">
    <div class="cook-top">
      <button class="icon-btn" data-act="cook-close" aria-label="요리 모드 닫기">${icon("x")}</button>
      <div class="progress" role="progressbar" aria-valuemin="1" aria-valuemax="${r.steps.length}" aria-valuenow="${cook.i + 1}" aria-label="진행 단계"><i style="width:${((cook.i + 1) / r.steps.length) * 100}%"></i></div>
      <span class="stepcount">${cook.i + 1} / ${r.steps.length}단계</span>
    </div>
    <div class="cook-main">
      <div class="stepno">${esc(r.title)}</div>
      <h2 id="cook-t">${esc(s.title)}</h2>
      <p class="big">${esc(s.instruction)}</p>
      ${s.heat || s.timer_seconds ? `<p class="cook-meta">${s.heat ? `${icon("flame")} ${esc(s.heat)}` : ""}${s.timer_seconds ? ` ${icon("timer")} 약 ${Math.round(s.timer_seconds / 60) || 1}분` : ""}</p>` : ""}
      ${s.done_when ? `<div class="done-when">${icon("check")}<span><b>다음으로 넘어갈 때</b> · ${esc(s.done_when)}</span></div>` : ""}
      ${s.tip ? `<div class="tip">${icon("bulb")}<span>${esc(s.tip)}</span></div>` : ""}
      ${s.timer_seconds ? `<div class="timer ${cook.left === 0 ? "ring" : ""}">
        <span class="t" aria-live="off">${mm}:${ss}</span>
        <button class="btn btn-ghost" data-act="cook-timer" data-key="cook-timer">${cook.running ? `${icon("pause")} 멈춤` : cook.left === 0 ? "다시" : `${icon("timer")} 타이머 시작`}</button>
      </div>` : ""}
    </div>
    <div>
      <div class="cook-bottom">
        <button class="btn btn-ghost btn-lg" data-act="cook-prev" ${cook.i === 0 ? "disabled" : ""}>${icon("back")} 이전</button>
        <button class="btn btn-primary btn-lg" data-act="${last ? "cook-done" : "cook-next"}" data-key="cook-next">${last ? `${icon("check")} 다 만들었어요` : `다음 단계 ${icon("next")}`}</button>
      </div>
      <p class="cook-hint">키보드: ← → 단계 이동 · Space 타이머 · Esc 닫기</p>
    </div>
  </div>`;
  overlayRoot.querySelector('[data-key="cook-next"]')?.focus();
}

function cookMove(d) {
  const n = cook.i + d;
  if (n < 0 || n >= cook.recipe.steps.length) return;
  cook.i = n;
  resetTimer();
  renderCook();
}

function toggleTimer() {
  if (!cook.recipe.steps[cook.i]?.timer_seconds) return;
  if (cook.left === 0) resetTimer();
  cook.running = !cook.running;
  clearInterval(cook.tick);
  if (cook.running) {
    cook.tick = setInterval(() => {
      cook.left = Math.max(0, cook.left - 1);
      if (cook.left === 0) {
        clearInterval(cook.tick);
        cook.running = false;
        navigator.vibrate?.([200, 100, 200]);
        toast("⏰ 시간이 다 됐어요! 상태를 확인하고 다음 단계로 넘어가세요");
        renderCook();
        return;
      }
      const t = overlayRoot.querySelector(".timer .t");
      if (t) t.textContent = `${String(Math.floor(cook.left / 60)).padStart(2, "0")}:${String(cook.left % 60).padStart(2, "0")}`;
    }, 1000);
  }
  renderCook();
}

async function finishCook() {
  const r = cook.recipe;
  const servings = r.servings || profile().servings;
  closeOverlay();
  try {
    await state.store.addCook({ id: uid(), recipeId: r.id, title: r.title, emoji: r.emoji || "🍽️", servings, date: Date.now() });
  } catch (e) { console.error(e); }
  markRecipe(r.id, "cook", true);
  toast(`집밥 완료! 외식 대신 약 ${won(profile().eatOutPrice * servings)}을 아꼈어요`);
  render();
  setTimeout(() => $("#note-input")?.focus(), 50);
}

function closeOverlay() {
  if (cook.tick) clearInterval(cook.tick);
  cook.recipe = null;
  const had = overlayRoot.innerHTML !== "";
  overlayRoot.innerHTML = "";
  return had;
}

// ───────── 내 레시피 ─────────

function viewMy() {
  const cooks = state.data.cooks;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthCooks = cooks.filter((c) => c.date >= monthStart);
  const meals = monthCooks.reduce((sum, c) => sum + (c.servings || 1), 0);
  const recipes = state.data.recipes;
  const filters = [
    ["all", "전체", recipes],
    ["fav", "즐겨찾기", recipes.filter((r) => r.favorite)],
    ["mine", "메모", recipes.filter((r) => r.notes?.length)],
    ["video", "영상", recipes.filter((r) => r.source === "video")],
  ];
  const [, , list] = filters.find(([id]) => id === state.myFilter) || filters[0];

  return `
  <header class="page-head"><h1 class="page-title">내 레시피</h1></header>

  <section class="savings" aria-label="이번 달 절약">
    <div class="k">${now.getMonth() + 1}월 예상 절약액</div>
    <div class="v">${won(meals * profile().eatOutPrice)}</div>
    <div class="s">직접 만든 식사 ${monthCooks.length}번 · 외식 1끼 ${won(profile().eatOutPrice)} 기준</div>
  </section>

  <div class="section">
    <div class="seg" role="group" aria-label="목록 고르기">
      ${filters.map(([id, label, l]) => `<button data-act="my-filter" data-v="${id}" data-key="my-${id}" aria-pressed="${state.myFilter === id}">${label} ${l.length}</button>`).join("")}
    </div>
    <div style="margin-top:16px">
      ${list.length ? `<div class="recipe-grid">${list.map((r, i) => cardHtml(annotate(r, pantry()), i)).join("")}</div>` : `
      <div class="empty">
        <img src="assets/empty-recipes.svg" alt="">
        <h2>아직 저장한 레시피가 없어요</h2>
        <p>레시피 화면에서 ☆을 누르거나 메모를 남기면 여기에 모여요.</p>
        <a class="btn btn-primary" href="#/find">${icon("search")} 요리 찾기</a>
      </div>`}
    </div>
  </div>

  ${videoSection()}

  ${cooks.length ? `<details class="section history-box">
    <summary>요리 기록 ${cooks.length}번 ${icon("next", "chev")}</summary>
    <ul class="history">${cooks.slice(0, 100).map((c) => `<li><span>${esc(c.emoji || "🍽️")} ${esc(c.title)} <span class="muted small">${c.servings}인분</span></span><time>${fmtDate(c.date)}</time></li>`).join("")}</ul>
  </details>` : ""}`;
}

function videoSection() {
  const v = state.video;
  if (v.draft) {
    const d = annotate(v.draft, pantry());
    const unsure = d.ingredients.filter((i) => i.amount === "확인 필요").length;
    return `<section class="section card video-card" aria-labelledby="draft-t">
      <h2 class="section-title" id="draft-t" tabindex="-1">${icon("video")} 정리한 레시피를 확인해 주세요</h2>
      <p class="draft-title">${esc(d.emoji)} <b>${esc(d.title)}</b> <span class="muted">${d.total_minutes ? `${d.total_minutes}분 · ` : ""}${d.steps.length}단계</span></p>
      ${unsure ? `<p class="need-line">${icon("info")}<span>양을 알 수 없는 재료 ${unsure}개는 <b>확인 필요</b>로 표시했어요.</span></p>` : ""}
      <ul class="ing-list compact">${d.ingredients.map((x) => `<li><span class="name">${esc(x.name)}</span><span class="qty ${x.amount === "확인 필요" ? "check-need" : ""}">${esc(x.amount)}</span></li>`).join("")}</ul>
      <ol class="draft-steps">${d.steps.map((s) => `<li>${esc(s.instruction)}</li>`).join("")}</ol>
      <div class="row">
        <button class="btn btn-ghost" data-act="video-cancel" data-key="video-cancel">버리기</button>
        <button class="btn btn-primary" data-act="video-save" data-key="video-save">내 레시피에 저장</button>
      </div>
    </section>`;
  }
  const hasKey = !!geminiInfo();
  return `<section class="section card video-card" aria-labelledby="video-t">
    <h2 class="section-title" id="video-t">${icon("video")} 유튜브 영상으로 레시피 추가</h2>
    <p class="muted small">요리 영상 링크를 붙여 넣으면 AI가 재료와 순서로 정리해요. 정리한 레시피는 나만 볼 수 있어요.</p>
    ${hasKey ? `
      <label class="sr-only" for="video-input">유튜브 영상 주소</label>
      <div class="add-row">
        <input class="input" id="video-input" data-key="video-input" type="url" inputmode="url" autocomplete="off" placeholder="https://youtu.be/…" value="${esc(v.url)}" data-enter="video-go" ${v.loading ? "disabled" : ""}>
        <button class="btn btn-ghost" data-act="video-go" data-key="video-go" ${v.loading ? "disabled" : ""}>${v.loading ? "정리 중…" : "정리하기"}</button>
      </div>
      ${v.loading ? `<p class="muted small" role="status">AI가 영상을 보고 있어요. 영상 길이에 따라 1분쯤 걸릴 수 있어요.</p>` : ""}
      ${v.error ? `<p class="err" role="alert">${icon("alert")}${esc(v.error)}</p>` : ""}
    ` : `<button class="btn btn-ghost" data-act="ai-open" data-key="video-ai-open">${icon("key")} AI 연결하고 쓰기</button>`}
  </section>`;
}

async function runVideo() {
  const input = $("#video-input");
  const url = (input?.value || "").trim();
  const v = state.video;
  v.url = url;
  if (!isYoutubeUrl(url)) { v.error = "유튜브 영상 주소를 붙여 넣어 주세요. (youtube.com/watch?v=… 또는 youtu.be/…)"; render(); $("#video-input")?.focus(); return; }
  v.loading = true;
  v.error = null;
  render();
  try {
    const out = await videoRecipe(url);
    if (out.status !== "ok") v.error = out.message || "이 영상에서는 레시피를 찾지 못했어요.";
    else v.draft = { ...out.recipes[0], id: newId("video"), source: "video", videoUrl: url };
  } catch (e) {
    console.error(e);
    v.error = e.message || "영상을 정리하지 못했어요.";
  } finally {
    v.loading = false;
    render();
    (v.draft ? $("#draft-t") : $("#video-input"))?.focus();
  }
}

// ───────── 설정 ─────────

function stepper(field, value, unit) {
  return `<div class="stepper" role="group" aria-label="${unit}">
    <button data-act="step" data-field="${field}" data-d="-1" data-key="${field}-minus" aria-label="줄이기">−</button>
    <output aria-live="polite">${value}${unit}</output>
    <button data-act="step" data-field="${field}" data-d="1" data-key="${field}-plus" aria-label="늘리기">+</button>
  </div>`;
}

function viewSettings() {
  const p = profile();
  const info = geminiInfo();
  const user = state.store.user;
  const name = user?.user_metadata?.full_name || user?.email || "";
  return `
  <header class="page-head"><h1 class="page-title">설정</h1></header>

  <div class="settings-group">
    <h2>계정</h2>
    <div class="settings-card">
      <div class="setting"><div class="head">
        <div><div class="t">${signedIn() ? `${esc(name)}` : "로그인 안 함"}</div>
        <div class="d">${signedIn() ? "재료와 레시피가 계정에 저장돼 다른 기기에서도 보여요." : config.supabase ? "구글로 로그인하면 다른 기기에서도 내 데이터가 보이고, AI가 찾은 요리를 모두와 나눌 수 있어요." : "지금은 이 기기 브라우저에만 저장돼요. (로그인 기능 준비 중)"}</div></div>
        ${signedIn()
          ? `<button class="btn btn-ghost btn-sm" data-act="logout" data-key="logout">${icon("logout")} 로그아웃</button>`
          : config.supabase ? `<button class="btn btn-primary btn-sm" data-act="login" data-key="login">Google로 로그인</button>` : ""}
      </div></div>
    </div>
  </div>

  <div class="settings-group">
    <h2>AI (제미나이)</h2>
    <div class="settings-card">
      <div class="setting"><div class="head">
        <div><div class="t"><span class="status-dot ${info ? "ok" : ""}"></span>${info ? "연결됨" : "연결 안 됨"}</div>
        <div class="d">${info ? `사용 모델: ${esc(modelLabel(info.model))}` : "키가 없어도 기본 레시피로 찾을 수 있어요."}</div></div>
        <button class="btn btn-ghost btn-sm" data-act="ai-open" data-key="set-ai">${info ? "관리" : "연결하기"}</button>
      </div></div>
    </div>
  </div>

  <div class="settings-group">
    <h2>요리</h2>
    <div class="settings-card">
      <div class="setting"><div class="head"><div class="t">기본 인분</div>${stepper("servings", p.servings, "인분")}</div></div>
      <div class="setting">
        <div><div class="t">빼고 싶은 재료</div><div class="d">알레르기나 싫어하는 재료는 추천에서 빠져요.</div></div>
        <div class="add-row">
          <label class="sr-only" for="tag-excluded">빼고 싶은 재료</label>
          <input class="input" id="tag-excluded" data-key="tag-excluded" placeholder="예: 땅콩, 오이" data-enter="add-excluded">
          <button class="btn btn-ghost" data-act="add-excluded" data-key="add-excluded">${icon("plus")} 추가</button>
        </div>
        <div class="chips">${p.excluded.length ? p.excluded.map((t) => `<button class="chip on" data-act="del-excluded" data-v="${esc(t)}" data-key="ex-${esc(t)}" aria-label="${esc(t)} 삭제">${esc(t)} ${icon("x", "x")}</button>`).join("") : `<span class="muted small">아직 없어요</span>`}</div>
      </div>
      <div class="setting">
        <div class="head">
          <label class="t" for="eat-out">외식 1끼 평균 금액</label>
          <input class="input" id="eat-out" data-key="eat-out" type="number" inputmode="numeric" min="0" step="500" value="${p.eatOutPrice}" style="max-width:140px;text-align:right">
        </div>
        <div class="d">요리를 끝낼 때마다 이 금액 × 인분만큼 아낀 것으로 계산해요.</div>
      </div>
    </div>
  </div>

  <div class="settings-group">
    <h2>화면</h2>
    <div class="settings-card">
      <div class="setting">
        <div class="t">테마</div>
        <div class="seg" role="group" aria-label="테마">
          ${[["system", "기기 설정"], ["light", "밝게"], ["dark", "어둡게"]].map(([v, l]) => `<button data-act="theme" data-v="${v}" data-key="theme-${v}" aria-pressed="${p.theme === v}">${l}</button>`).join("")}
        </div>
      </div>
      <div class="setting">
        <div class="t" style="display:flex;gap:8px;align-items:center">${icon("keyboard")} 키보드 단축키</div>
        <div class="kbd-help">
          <span><kbd>1</kbd>~<kbd>3</kbd></span><span>메뉴 이동 (요리 찾기 · 내 레시피 · 설정)</span>
          <span><kbd>/</kbd></span><span>재료 입력칸으로 바로 가기</span>
          <span><kbd>Tab</kbd></span><span>다음 버튼으로 이동, <kbd>Enter</kbd>/<kbd>Space</kbd>로 누르기</span>
          <span><kbd>Esc</kbd></span><span>뒤로 가기 · 창 닫기</span>
          <span><kbd>←</kbd> <kbd>→</kbd></span><span>요리 모드에서 단계 이동</span>
        </div>
      </div>
    </div>
  </div>

  <div class="settings-group">
    <h2>데이터</h2>
    <div class="settings-card">
      <div class="setting"><div class="head"><div><div class="t">내 데이터 내려받기</div><div class="d">재료·레시피·기록을 파일(JSON)로 저장해요.</div></div><button class="btn btn-ghost btn-sm" data-act="export" data-key="export">${icon("download")} 내려받기</button></div></div>
      <div class="setting"><div class="head"><div><div class="t">내 데이터 모두 지우기</div><div class="d">되돌릴 수 없어요.</div></div><button class="btn btn-danger btn-sm" data-act="reset" data-key="reset">${icon("trash")} 지우기</button></div></div>
    </div>
  </div>
  <p class="muted small" style="text-align:center;margin-top:32px">식비를 줄여라 · 베타 · <a class="link" href="privacy.html" data-key="privacy">개인정보처리방침</a> · <a class="link" href="https://github.com/eastflame28-bit/sikbi-julyeora/issues" target="_blank" rel="noopener">문의</a></p>`;
}

function confirmSheet({ title, body, ok, danger }) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    overlayRoot.innerHTML = `<div class="scrim" data-act="sheet-cancel">
      <div class="sheet" role="alertdialog" aria-modal="true" aria-labelledby="sheet-t" aria-describedby="sheet-d">
        <h2 id="sheet-t">${title}</h2><p id="sheet-d">${body}</p>
        <div class="row">
          <button class="btn btn-ghost" data-act="sheet-cancel">취소</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="sheet-ok">${ok}</button>
        </div>
      </div></div>`;
    overlayRoot.querySelector('[data-act="sheet-cancel"].btn').focus();
    sheetResolve = (v) => { overlayRoot.innerHTML = ""; sheetResolve = null; opener?.focus?.(); resolve(v); };
  });
}
let sheetResolve = null;

async function reloadStore() {
  const { store, error } = await openStore();
  state.store = store;
  state.data = store.data;
  state.storeError = error;
  state.resultsKey = "";
  applyTheme(state.data.profile.theme);
}

// ───────── 이벤트 ─────────

const actions = {
  "ai-toggle": () => (state.key.open ? closeKeyPanel() : openKeyPanel()),
  "ai-open": () => openKeyPanel(),
  "ai-connect": () => connectKey(),
  "ai-disconnect": async () => {
    disconnectGemini();
    state.key.just = false;
    state.ai = { loading: false, error: null, list: state.ai.list };
    toast("제미나이 연결을 끊고 키를 지웠어요");
    render();
    $("#key-input")?.focus();
  },
  "add-pantry": addPantryFromInput,
  "add-one": (el) => { addPantry(el.dataset.v); },
  "del-pantry": (el) => savePantry(pantry().filter((p) => p.name !== el.dataset.v)),
  "clear-pantry": async () => {
    const ok = await confirmSheet({ title: "넣은 재료를 모두 지울까요?", body: "기본 양념은 그대로 남아요.", ok: "모두 지우기", danger: true });
    if (ok) savePantry(pantry().filter((p) => BASICS.includes(norm(p.name))));
  },
  "toggle-basic": (el) => {
    const n = el.dataset.v;
    const on = pantry().some((p) => norm(p.name) === n);
    savePantry(on ? pantry().filter((p) => norm(p.name) !== n) : [...pantry(), { name: n }]);
  },
  "basics-toggle": (el, e) => {
    // <details>의 기본 열고 닫기를 쓰되, 다시 그릴 때도 열린 상태를 기억한다
    state.basicsOpen = !el.parentElement.open;
    e.preventDefault();
    el.parentElement.open = state.basicsOpen;
  },
  search: () => {
    state.searched = true;
    state.ai.error = null;
    ensureResults(true);
    updateResults();
    setTimeout(() => {
      const t = $("#results-t") || $("#results");
      t?.focus?.({ preventScroll: true });
      $("#results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
  },
  "ai-search": () => runAi(),
  cat: (el) => { state.cat = el.dataset.v; state.more = {}; updateResults(); },
  more: (el) => {
    const k = el.dataset.v;
    state.more[k] = (state.more[k] || FIRST[k]) + 12;
    updateResults();
  },
  "basics-common": () => {
    const have = new Set(pantry().map((p) => norm(p.name)));
    const add = COMMON_BASICS.filter((n) => !have.has(n)).map((name) => ({ name }));
    savePantry([...pantry(), ...add]);
    toast(`흔한 양념 ${add.length}개를 골랐어요. 없는 건 눌러서 빼 주세요`);
  },
  back: () => { if (history.length > 1) history.back(); else go("find"); },
  fav: async (el) => {
    const r = findRecipe(el.dataset.v);
    if (!r) return;
    const now = !savedVersion(r.id)?.favorite;
    await upsertSaved(r, { favorite: now });
    markRecipe(r.id, "fav", now);
    toast(now ? "즐겨찾기에 담았어요" : "즐겨찾기에서 뺐어요");
    render();
  },
  "save-note": async (el) => {
    const r = findRecipe(el.dataset.v);
    const input = $("#note-input");
    const text = input.value.trim();
    if (!text) { input.focus(); toast("메모를 먼저 적어 주세요"); return; }
    const prev = savedVersion(r.id)?.notes || [];
    await upsertSaved(r, { notes: [{ text, date: Date.now() }, ...prev] });
    toast("나만의 레시피로 저장했어요");
    render();
  },
  cook: (el) => openCook(el.dataset.v),
  "cook-close": () => { closeOverlay(); $('[data-key="cook"]')?.focus(); },
  "cook-prev": () => cookMove(-1),
  "cook-next": () => cookMove(1),
  "cook-timer": () => toggleTimer(),
  "cook-done": () => finishCook(),
  "my-filter": (el) => { state.myFilter = el.dataset.v; render(); },
  "video-go": () => runVideo(),
  "video-cancel": () => { state.video.draft = null; render(); $("#video-input")?.focus(); },
  "video-save": async () => {
    const d = state.video.draft;
    cacheRecipe(d);
    await upsertSaved(d, {});
    state.video = { loading: false, error: null, draft: null, url: "" };
    state.myFilter = "video";
    toast("영상 레시피를 내 레시피에 저장했어요");
    go(`recipe/${encodeURIComponent(d.id)}`);
  },
  step: async (el) => {
    const f = el.dataset.field;
    await saveProfile({ [f]: Math.min(8, Math.max(1, profile()[f] + Number(el.dataset.d))) });
    render();
  },
  "add-excluded": async () => {
    const input = $("#tag-excluded");
    const items = input.value.split(/[,，、]/).map(norm).filter(Boolean);
    if (!items.length) return input.focus();
    await saveProfile({ excluded: [...new Set([...profile().excluded, ...items])] });
    render();
    $("#tag-excluded")?.focus();
  },
  "del-excluded": async (el) => { await saveProfile({ excluded: profile().excluded.filter((t) => t !== el.dataset.v) }); render(); },
  theme: async (el) => { await saveProfile({ theme: el.dataset.v }); applyTheme(el.dataset.v); render(); },
  login: async () => {
    try { await signInWithGoogle(); } catch (e) { console.error(e); toast("구글 로그인을 열지 못했어요. 잠시 후 다시 시도해 주세요."); }
  },
  logout: async () => {
    const ok = await confirmSheet({ title: "로그아웃할까요?", body: "계정에 저장된 데이터는 그대로 남아요. 다시 로그인하면 보여요.", ok: "로그아웃" });
    if (!ok) return;
    await signOut();
    await reloadStore();
    toast("로그아웃했어요");
    render({ focusMain: true });
  },
  export: () => {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `식비를줄여라-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  reset: async () => {
    const ok = await confirmSheet({ title: "내 데이터를 모두 지울까요?", body: "재료, 즐겨찾기, 메모, 요리 기록이 모두 사라지고 되돌릴 수 없어요. 모두의 레시피 창고는 그대로예요.", ok: "모두 지우기", danger: true });
    if (!ok) return;
    try { await state.store.resetAll(); } catch (e) { console.error(e); toast("지우지 못했어요. 잠시 후 다시 시도해 주세요."); return; }
    state.data = state.store.data;
    state.results = null; state.resultsKey = ""; state.searched = false;
    applyTheme("system");
    toast("내 데이터를 모두 지웠어요");
    render({ focusMain: true });
  },
  "sheet-ok": () => sheetResolve?.(true),
  "sheet-cancel": () => sheetResolve?.(false),
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  // 시트 바깥(어두운 배경)을 눌렀을 때만 닫고, 시트 안쪽 클릭은 무시
  if (el.classList.contains("scrim") && e.target !== el) return;
  const fn = actions[el.dataset.act];
  if (fn) { if (el.dataset.act !== "basics-toggle") e.preventDefault(); fn(el, e); }
});

document.addEventListener("change", async (e) => {
  if (e.target.id === "eat-out") {
    const v = Math.max(0, Number(e.target.value) || 0);
    await saveProfile({ eatOutPrice: v });
    toast(`외식 1끼 ${won(v)}로 바꿨어요`);
  }
});

document.addEventListener("keydown", (e) => {
  const t = e.target;
  const typing = t.matches?.("input, textarea, select");

  // 한글 조합 중 Enter는 글자 확정이므로 건너뛴다
  if (typing && e.key === "Enter" && t.dataset.enter) {
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    actions[t.dataset.enter]?.(t);
    return;
  }
  if (t.id === "note-input" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    main.querySelector('[data-act="save-note"]')?.click();
    return;
  }

  if (cook.recipe && overlayRoot.querySelector(".cook")) {
    if (e.key === "ArrowRight") { e.preventDefault(); cook.i === cook.recipe.steps.length - 1 ? finishCook() : cookMove(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); cookMove(-1); }
    else if (e.key === " " && !t.matches("button")) { e.preventDefault(); toggleTimer(); }
    else if (e.key === "Escape") { e.preventDefault(); actions["cook-close"](); }
    else if (e.key === "Tab") trapFocus(e, overlayRoot.querySelector(".cook"));
    return;
  }
  if (sheetResolve) {
    if (e.key === "Escape") sheetResolve(false);
    else if (e.key === "Tab") trapFocus(e, overlayRoot.querySelector(".sheet"));
    return;
  }
  if (e.key === "Escape" && state.key.open && t.closest?.("#topbar")) { e.preventDefault(); closeKeyPanel(); return; }

  if (typing) {
    if (e.key === "Escape") t.blur();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const n = Number(e.key);
  if (n >= 1 && n <= TABS.length) { e.preventDefault(); go(TABS[n - 1].id); return; }
  if (e.key === "/") {
    e.preventDefault();
    if (state.route.name !== "find") go("find");
    setTimeout(() => $("#pantry-input")?.focus(), 0);
    return;
  }
  if (e.key === "Escape") {
    if (state.key.open) { e.preventDefault(); closeKeyPanel(); }
    else if (state.route.name === "recipe" || state.route.name === "subs") { e.preventDefault(); actions.back(); }
  }
});

function trapFocus(e, box) {
  const items = [...box.querySelectorAll("button:not([disabled]), [href], input, textarea")];
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ───────── 시작 ─────────

(async function start() {
  main.innerHTML = `<div class="loading"><img src="assets/logo.svg" alt="" style="width:72px;border-radius:18px"><p>불러오는 중…</p></div>`;
  await reloadStore();
  restoreCache();
  state.route = parseRoute();
  state.searched = pantry().length > 0;
  render();
  if (state.store.migrated) toast("이 기기에 있던 재료와 레시피를 계정으로 옮겼어요");
})();
