// 식비를 줄여라 — 화면과 동작

import { icon } from "./icons.js";
import { CATEGORIES, KNOWN, norm } from "./catalog.js";
import { openStore, uid } from "./store.js";
import { recommend, detail, aiMode, annotate } from "./ai.js";
import { DEMO_RECIPES } from "./demo-recipes.js";

const $ = (sel, root = document) => root.querySelector(sel);
const main = $("#main");
const tabbar = $("#tabbar");
const overlayRoot = $("#overlay-root");

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const won = (n) => "₩" + Math.round(n).toLocaleString("ko-KR");
const fmtDate = (t) => new Date(t).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });

const SKILLS = {
  beginner: { label: "초보", emoji: "🌱", desc: "칼질·불 세기까지 하나하나 알려 드려요" },
  intermediate: { label: "중급", emoji: "🍳", desc: "기본 반찬은 OK, 핵심 순서 위주로" },
  advanced: { label: "숙련자", emoji: "👩‍🍳", desc: "재료 조합과 요령만 간단히" },
};
const TIMES = [
  { id: "5", label: "5분" },
  { id: "15", label: "15분" },
  { id: "30", label: "30분" },
  { id: "free", label: "여유 있게" },
];
const DIFF = { easy: "쉬움", medium: "보통", hard: "어려움" };
const TABS = [
  { id: "pantry", label: "내 재료", icon: "fridge" },
  { id: "recommend", label: "추천 요리", icon: "sparkle" },
  { id: "my", label: "내 레시피", icon: "book" },
  { id: "settings", label: "설정", icon: "gear" },
];

const state = {
  store: null,
  data: null,
  storeError: null,
  route: { name: "", param: "" },
  onbStep: 0,
  time: "30",
  servings: null,
  results: null,
  resultsKey: "",
  loading: false,
  loadError: null,
  cache: new Map(),
  myTab: "fav",
  detailLoading: false,
  detailError: null,
};

// ───────── 공통 ─────────

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;
}

const profile = () => state.data.profile;
const pantry = () => state.data.pantry;

async function saveProfile(patch) {
  const next = { ...profile(), ...patch };
  await state.store.saveProfile(next);
  state.data.profile = next;
}

async function savePantry(list) {
  state.data.pantry = list;
  render();
  try { await state.store.savePantry(list); } catch (e) { console.error(e); toast("저장하지 못했어요. 잠시 후 다시 시도해 주세요."); }
}

function findRecipe(id) {
  return state.cache.get(id)
    || state.data.recipes.find((r) => r.id === id)
    || DEMO_RECIPES.find((r) => r.id === id)
    || null;
}

// 새로고침해도 방금 받은 추천(특히 AI 레시피)이 사라지지 않도록 탭이 열려 있는 동안 보관
const CACHE_KEY = "sikbi:cache";
function cacheRecipe(r) {
  state.cache.set(r.id, r);
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify([...state.cache.values()].slice(-40))); } catch { /* 무시 */ }
}
function restoreCache() {
  try { for (const r of JSON.parse(sessionStorage.getItem(CACHE_KEY) || "[]")) state.cache.set(r.id, r); } catch { /* 무시 */ }
}

function savedVersion(id) {
  return state.data.recipes.find((r) => r.id === id) || null;
}

async function upsertSaved(recipe, patch) {
  const base = savedVersion(recipe.id) || stripForSave(recipe);
  const next = { ...base, ...patch, updatedAt: Date.now() };
  const keep = next.favorite || next.notes?.length;
  if (keep) await state.store.putRecipe(next);
  else await state.store.removeRecipe(recipe.id);
  return next;
}

// 저장할 때는 화면용 계산값(have, missing 등)을 빼고 원래 레시피만 남긴다
function stripForSave(r) {
  return {
    id: r.id, title: r.title, emoji: r.emoji || "🍽️", reason: r.reason || "",
    total_minutes: r.total_minutes, difficulty: r.difficulty, servings: r.servings,
    equipment: r.equipment || [], source: r.source,
    ingredients: r.ingredients.map(({ name, amount, optional }) => ({ name, amount: amount ?? "", optional: !!optional })),
    steps: r.steps || [], favorite: false, notes: [], createdAt: Date.now(),
  };
}

// ───────── 라우터 ─────────

function parseRoute() {
  const [name = "", param = ""] = location.hash.replace(/^#\/?/, "").split("/");
  return { name: name || "pantry", param: decodeURIComponent(param) };
}

function go(path) {
  if (location.hash === "#/" + path) render();
  else location.hash = "#/" + path;
}

window.addEventListener("hashchange", () => {
  const prev = state.route.name;
  state.route = parseRoute();
  state.detailError = null;
  closeOverlay();
  render({ focusMain: true });
  if (prev !== state.route.name) window.scrollTo(0, 0);
});

// ───────── 렌더링 ─────────

function render({ focusMain = false } = {}) {
  const active = document.activeElement;
  const key = active?.dataset?.key;

  if (!profile().onboarded) state.route = { name: "onboarding", param: "" };
  const r = state.route;
  const views = { onboarding: viewOnboarding, pantry: viewPantry, recommend: viewRecommend, recipe: viewRecipe, my: viewMy, settings: viewSettings };
  const view = views[r.name] || viewPantry;

  const showTabs = r.name !== "onboarding";
  tabbar.hidden = !showTabs;
  document.querySelector(".app-shell").classList.toggle("has-tabbar", showTabs);
  main.className = "screen" + (showTabs ? "" : " no-tabbar");
  if (showTabs) renderTabbar(r.name === "recipe" ? (state.lastTab || "recommend") : r.name);
  else state.lastTab = null;
  if (["pantry", "recommend", "my", "settings"].includes(r.name)) state.lastTab = r.name;

  main.innerHTML = `<div class="inner">${view(r.param)}</div>`;
  if (r.name === "recommend") ensureResults();
  if (r.name === "recipe") ensureDetail(r.param);

  if (key) {
    const again = main.querySelector(`[data-key="${CSS.escape(key)}"]`);
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
  const out = [];
  if (state.storeError) {
    out.push(`<div class="banner" role="alert">${icon("alert")}<span>클라우드(Firebase)에 연결하지 못해 <b>이 기기에 임시 저장</b>하고 있어요. 인터넷 연결이나 설정을 확인해 주세요.</span></div>`);
  }
  return out.join("");
}

// ───────── 처음 설정 ─────────

function viewOnboarding() {
  const p = profile();
  const step = state.onbStep;
  const dots = `<div class="dots" aria-hidden="true">${[0, 1, 2].map((i) => `<i class="${i === step ? "on" : ""}"></i>`).join("")}</div>`;

  if (step === 0) {
    return `<section class="onb" aria-labelledby="onb-t">
      ${dots}
      <img class="hero" src="assets/hero.svg" alt="">
      <h1 id="onb-t">냉장고 속 재료로<br>오늘 한 끼, 자신 있게</h1>
      <p class="lead">가진 양념과 재료만 고르면 지금 만들 수 있는 요리를 찾아 드려요. 배달 대신 집밥으로 식비를 줄여 보세요.</p>
      <div class="nav" style="grid-template-columns:1fr"><button class="btn btn-primary btn-block" data-act="onb-next" data-key="onb-next">시작하기 ${icon("next")}</button></div>
    </section>`;
  }
  if (step === 1) {
    return `<section class="onb" aria-labelledby="onb-t">
      ${dots}
      <h1 id="onb-t">요리 실력이 어느 정도인가요?</h1>
      <p class="lead">실력에 맞춰 설명의 자세한 정도가 달라져요. 나중에 설정에서 바꿀 수 있어요.</p>
      <div class="body" role="group" aria-label="요리 실력">
        ${Object.entries(SKILLS).map(([id, s]) => `
          <button class="level-card" data-act="set-skill" data-v="${id}" data-key="skill-${id}" aria-pressed="${p.skill === id}">
            <span class="ic" aria-hidden="true">${s.emoji}</span>
            <span><span class="t">${s.label}</span><br><span class="d">${s.desc}</span></span>
          </button>`).join("")}
        <div class="card" style="display:flex;align-items:center;justify-content:space-between">
          <span><b>몇 인분</b>을 주로 만드세요?</span>
          ${stepper("servings", p.servings, "인분")}
        </div>
      </div>
      <div class="nav">
        <button class="btn btn-ghost" data-act="onb-prev">${icon("back")} 이전</button>
        <button class="btn btn-primary" data-act="onb-next" data-key="onb-next">다음 ${icon("next")}</button>
      </div>
    </section>`;
  }
  return `<section class="onb" aria-labelledby="onb-t">
    ${dots}
    <h1 id="onb-t">못 먹거나 빼고 싶은 재료가 있나요?</h1>
    <p class="lead">알레르기나 싫어하는 재료는 추천에서 빼 드릴게요. 없으면 바로 넘어가도 돼요.</p>
    <div class="body">
      ${tagEditor("excluded", "예: 땅콩, 오이, 고수")}
    </div>
    <div class="nav">
      <button class="btn btn-ghost" data-act="onb-prev">${icon("back")} 이전</button>
      <button class="btn btn-primary" data-act="onb-done" data-key="onb-done">재료 고르러 가기 ${icon("next")}</button>
    </div>
  </section>`;
}

function stepper(field, value, unit) {
  return `<span class="stepper" role="group" aria-label="${unit}">
    <button data-act="step" data-field="${field}" data-d="-1" data-key="${field}-minus" aria-label="줄이기">−</button>
    <output aria-live="polite">${value}${unit}</output>
    <button data-act="step" data-field="${field}" data-d="1" data-key="${field}-plus" aria-label="늘리기">+</button>
  </span>`;
}

function tagEditor(field, placeholder) {
  const list = profile()[field] || [];
  return `<div class="field">
    <div class="add-row">
      <input class="input" id="tag-${field}" data-key="tag-${field}" data-enter="add-tag" data-field="${field}" placeholder="${placeholder}" autocomplete="off" aria-label="뺄 재료 입력">
      <button class="btn btn-ghost" data-act="add-tag" data-field="${field}">${icon("plus")} 추가</button>
    </div>
    <div class="chips" style="margin-top:8px">
      ${list.length ? list.map((t) => `<button class="chip" data-act="del-tag" data-field="${field}" data-v="${esc(t)}" data-key="tag-${field}-${esc(t)}" aria-label="${esc(t)} 지우기">${esc(t)} ${icon("x", "x")}</button>`).join("") : `<span class="muted small">아직 없어요</span>`}
    </div>
  </div>`;
}

// ───────── 내 재료 ─────────

function viewPantry() {
  const list = pantry();
  const names = new Set(list.map((p) => p.name));
  const seasoningCount = list.filter((p) => p.kind === "seasoning").length;
  const custom = list.filter((p) => !KNOWN.has(p.name));

  return `${banners()}
  <header class="page-head">
    <div><h1 class="page-title">내 재료</h1><p class="page-sub">집에 있는 양념과 재료를 눌러서 골라 주세요.</p></div>
  </header>

  <div class="add-row">
    <div class="search-wrap" style="flex:1">
      ${icon("plus")}
      <input class="input" id="pantry-input" data-key="pantry-input" data-enter="add-pantry" placeholder="재료 직접 입력 (쉼표로 여러 개)" autocomplete="off" aria-label="재료 이름 입력">
      <span class="hint" aria-hidden="true">/</span>
    </div>
    <button class="btn btn-primary" data-act="add-pantry">추가</button>
  </div>

  ${list.length ? `
  <div class="pantry-summary">
    ${icon("fridge")}
    <span>양념 <strong>${seasoningCount}</strong>개 · 재료 <strong>${list.length - seasoningCount}</strong>개를 골랐어요</span>
  </div>
  <section class="section" aria-labelledby="sel-t">
    <h2 class="section-title" id="sel-t">고른 재료 <span class="count">☆를 누르면 '먼저 쓸 재료'가 돼요</span></h2>
    <div class="chips">
      ${list.map((p) => `
        <span class="chip ${p.useFirst ? "first" : ""}" style="padding-right:4px">
          ${esc(p.name)}
          <button class="icon-btn ${p.useFirst ? "on" : ""}" style="width:32px;height:32px;border:0;background:none" data-act="first" data-v="${esc(p.name)}" data-key="first-${esc(p.name)}" aria-pressed="${!!p.useFirst}" aria-label="${esc(p.name)} 먼저 쓰기">${icon("star")}</button>
          <button class="icon-btn" style="width:32px;height:32px;border:0;background:none" data-act="toggle-item" data-v="${esc(p.name)}" data-key="rm-${esc(p.name)}" aria-label="${esc(p.name)} 빼기">${icon("x")}</button>
        </span>`).join("")}
    </div>
  </section>` : `
  <div class="empty">
    <img src="assets/empty-fridge.svg" alt="">
    <h2>아직 고른 재료가 없어요</h2>
    <p>아래 목록에서 집에 있는 양념과 재료를 3개 이상 골라 보세요.</p>
  </div>`}

  ${CATEGORIES.map((c) => `
    <section class="cat" aria-labelledby="cat-${c.id}">
      <div class="cat-head"><h2 class="cat-title" id="cat-${c.id}"><span aria-hidden="true">${c.emoji}</span>${c.label}</h2></div>
      <div class="chips">
        ${c.items.map((n) => `<button class="chip" data-act="toggle-item" data-v="${n}" data-kind="${c.kind}" data-key="item-${n}" aria-pressed="${names.has(n)}">${names.has(n) ? icon("check") : ""}${n}</button>`).join("")}
        ${c.id === "etc" ? custom.map((p) => `<button class="chip" data-act="toggle-item" data-v="${esc(p.name)}" data-key="item-${esc(p.name)}" aria-pressed="true">${icon("check")}${esc(p.name)}</button>`).join("") : ""}
      </div>
    </section>`).join("")}

  <div class="sticky-cta">
    <button class="btn btn-primary btn-block" data-act="go-recommend" data-key="go-recommend" ${list.length ? "" : "disabled"}>
      ${icon("sparkle")} 이 재료로 요리 추천받기
    </button>
  </div>`;
}

function addPantryFromInput() {
  const input = $("#pantry-input");
  const raw = input.value.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean);
  if (!raw.length) { input.focus(); return; }
  const list = [...pantry()];
  const added = [];
  for (const name of raw) {
    const n = norm(name);
    if (!n || list.some((p) => p.name === n)) continue;
    const cat = CATEGORIES.find((c) => c.items.includes(n));
    list.push({ name: n, kind: cat ? cat.kind : "fridge", useFirst: false });
    added.push(n);
  }
  input.value = "";
  if (added.length) {
    savePantry(list);
    toast(`${added.join(", ")} 추가했어요`);
  }
  $("#pantry-input")?.focus();
}

// ───────── 추천 ─────────

function viewRecommend() {
  const p = profile();
  const servings = state.servings ?? p.servings;
  const demo = aiMode(state.store) === "demo";
  if (!pantry().length) {
    return `<header class="page-head"><div><h1 class="page-title">추천 요리</h1></div></header>
      <div class="empty">
        <img src="assets/empty-fridge.svg" alt="">
        <h2>먼저 가진 재료를 골라 주세요</h2>
        <p>재료를 알려 주시면 지금 만들 수 있는 요리를 찾아 드려요.</p>
        <a class="btn btn-primary" href="#/pantry" data-key="to-pantry">${icon("fridge")} 재료 고르러 가기</a>
      </div>`;
  }

  return `${banners()}
  <header class="page-head">
    <div><h1 class="page-title">추천 요리</h1><p class="page-sub">재료 ${pantry().length}개로 만들 수 있는 요리예요.</p></div>
    <a class="badge" href="#/settings" style="text-decoration:none" aria-label="요리 실력 ${SKILLS[p.skill].label}, 설정에서 바꾸기">${SKILLS[p.skill].emoji} ${SKILLS[p.skill].label}</a>
  </header>
  ${demo ? `<div class="banner info">${icon("info")}<span><b>예시 레시피 모드</b> · 지금은 앱에 들어 있는 레시피 16개 안에서 골라 드려요. AI를 연결하면 GPT가 내 재료에 맞춰 새로 만들어 줘요.</span></div>` : ""}
  <div class="filters">
    <div class="filter-row" role="group" aria-label="조리 시간">
      <span class="label">${icon("clock")}</span>
      ${TIMES.map((t) => `<button class="chip" data-act="time" data-v="${t.id}" data-key="time-${t.id}" aria-pressed="${state.time === t.id}">${t.label}${t.id !== "free" ? " 이내" : ""}</button>`).join("")}
    </div>
    <div class="filter-row" role="group" aria-label="인분">
      <span class="label">${icon("users")}</span>
      ${[1, 2, 3, 4].map((n) => `<button class="chip" data-act="servings" data-v="${n}" data-key="srv-${n}" aria-pressed="${servings === n}">${n}인분</button>`).join("")}
    </div>
  </div>
  <div id="results" aria-live="polite">${resultsHtml()}</div>`;
}

function resultsHtml() {
  if (state.loading) {
    return `<div class="loading"><img src="assets/cooking.svg" alt=""><p>${aiMode(state.store) === "ai" ? "GPT가 레시피를 찾고 있어요…" : "레시피를 찾고 있어요…"}</p></div>`;
  }
  if (state.loadError) {
    return `<div class="empty">
      <img src="assets/cooking.svg" alt="">
      <h2>추천 서버에 연결하지 못했어요</h2>
      <p>${esc(state.loadError)}</p>
      <button class="btn btn-primary" data-act="retry" data-key="retry">다시 시도</button>
    </div>`;
  }
  const res = state.results;
  if (!res) return "";
  if (!res.ready.length && !res.almost.length) {
    return `<div class="empty">
      <img src="assets/empty-recipes.svg" alt="">
      <h2>조건에 맞는 요리를 찾지 못했어요</h2>
      <p>${esc(res.message || "조리 시간을 늘리거나 재료를 몇 가지 더 골라 보세요.")}</p>
      <div class="chips" style="justify-content:center">
        ${state.time !== "free" ? `<button class="btn btn-ghost btn-sm" data-act="time" data-v="free">시간 제한 없애기</button>` : ""}
        <a class="btn btn-ghost btn-sm" href="#/pantry">재료 더 고르기</a>
      </div>
    </div>`;
  }
  return `
    ${res.ready.length ? `<section class="section" aria-labelledby="ready-t">
      <h2 class="section-title" id="ready-t">${icon("check")} 바로 만들 수 있어요 <span class="count">${res.ready.length}개</span></h2>
      <div class="recipe-grid">${res.ready.map(cardHtml).join("")}</div>
    </section>` : ""}
    ${res.almost.length ? `<section class="section" aria-labelledby="almost-t">
      <h2 class="section-title" id="almost-t">${icon("cart")} 조금만 더 있으면 <span class="count">${res.almost.length}개</span></h2>
      <div class="recipe-grid">${res.almost.map(cardHtml).join("")}</div>
    </section>` : ""}
    <p class="ai-note">${icon("sparkle")}${res.source === "ai" ? "AI가 추천한 요리예요. 간과 익힘은 직접 확인해 주세요." : "예시 레시피 중에서 골랐어요."}</p>`;
}

function cardHtml(r, idx = 0) {
  const saved = savedVersion(r.id);
  return `<a class="rcard" href="#/recipe/${encodeURIComponent(r.id)}" data-key="card-${esc(r.id)}" style="animation-delay:${Math.min(idx, 6) * 40}ms">
    <span class="thumb" aria-hidden="true">${esc(r.emoji || "🍽️")}</span>
    <span>
      <h3>${esc(r.title)}</h3>
      <span class="meta">
        <span>${icon("clock")}${r.total_minutes}분</span>
        <span>${DIFF[r.difficulty] || ""}</span>
        ${saved?.favorite ? `<span>${icon("star")}즐겨찾기</span>` : ""}
        ${saved?.notes?.length ? `<span>${icon("edit")}나만의 레시피</span>` : ""}
      </span>
      ${r.reason ? `<p class="reason">${esc(r.reason)}</p>` : ""}
      ${r.missing?.length ? `<p class="need"><span class="badge warn">${icon("cart")} ${r.missing.map(esc).join(", ")} 필요</span></p>` : ""}
    </span>
  </a>`;
}

async function ensureResults(force = false) {
  const p = profile();
  const servings = state.servings ?? p.servings;
  const key = JSON.stringify([pantry().map((x) => x.name + (x.useFirst ? "*" : "")), state.time, servings, p.skill, p.allergies, p.excluded]);
  if (!force && (state.resultsKey === key || state.loading) || !pantry().length) return;
  state.resultsKey = key;
  state.loading = true;
  state.loadError = null;
  updateResults();
  try {
    const res = await recommend({ store: state.store, profile: p, pantry: pantry(), time: state.time, servings, recipes: state.data.recipes });
    if (state.resultsKey !== key) return;
    state.results = res;
    [...res.ready, ...res.almost].forEach(cacheRecipe);
  } catch (e) {
    console.error(e);
    state.loadError = e?.message?.includes("resource-exhausted") ? "오늘 쓸 수 있는 추천 횟수를 다 썼어요. 내일 다시 시도해 주세요." : "인터넷 연결을 확인하고 다시 시도해 주세요.";
    state.resultsKey = "";
  } finally {
    state.loading = false;
    updateResults();
  }
}

function updateResults() {
  const box = $("#results");
  if (box && state.route.name === "recommend") box.innerHTML = resultsHtml();
}

// ───────── 레시피 ─────────

function viewRecipe(id) {
  let r = findRecipe(id);
  if (!r) {
    return `<div class="empty">
      <img src="assets/empty-recipes.svg" alt="">
      <h2>레시피를 찾을 수 없어요</h2>
      <p>추천 목록에서 다시 골라 주세요.</p>
      <a class="btn btn-primary" href="#/recommend">추천 요리로 가기</a>
    </div>`;
  }
  r = annotate(r, pantry());
  const saved = savedVersion(r.id);
  const notes = saved?.notes || [];
  const skill = profile().skill;
  const hasSteps = r.steps?.length > 0;

  return `
  <div class="back-row">
    <button class="icon-btn" data-act="back" data-key="back" aria-label="뒤로 가기">${icon("back")}</button>
    <div class="actions">
      <button class="icon-btn ${saved?.favorite ? "on" : ""}" data-act="fav" data-v="${esc(r.id)}" data-key="fav" aria-pressed="${!!saved?.favorite}" aria-label="즐겨찾기">${icon("star")}</button>
    </div>
  </div>

  <header class="recipe-hero">
    <span class="thumb" aria-hidden="true">${esc(r.emoji || "🍽️")}</span>
    <div>
      <h1>${esc(r.title)}</h1>
      <div class="tags">
        <span class="badge ${r.source === "ai" ? "" : "accent"}">${r.source === "ai" ? `${icon("sparkle")} AI 추천` : "예시 레시피"}</span>
        <span class="badge">${SKILLS[skill].emoji} ${SKILLS[skill].label}용 설명</span>
        ${notes.length ? `<span class="badge accent">${icon("edit")} 나만의 레시피</span>` : ""}
      </div>
    </div>
  </header>

  <div class="stat-row">
    <div class="stat"><div class="k">조리 시간</div><div class="v">${r.total_minutes}분</div></div>
    <div class="stat"><div class="k">분량</div><div class="v">${r.servings}인분</div></div>
    <div class="stat"><div class="k">난이도</div><div class="v">${DIFF[r.difficulty] || "-"}</div></div>
  </div>

  ${notes.length ? `<div class="banner info" style="margin-top:16px">${icon("edit")}<span><b>지난번 내 메모</b> · ${esc(notes[0].text)}</span></div>` : ""}

  <div class="recipe-body">
    <aside class="aside">
      <section class="card" aria-labelledby="ing-t">
        <h2 class="section-title" id="ing-t">재료 <span class="count">${r.ingredients.filter((x) => x.have).length}/${r.ingredients.length} 있음</span></h2>
        ${r.missing.length ? `<div class="banner" style="margin:0 0 8px">${icon("cart")}<span><b>${r.missing.map(esc).join(", ")}</b>만 있으면 바로 만들 수 있어요</span></div>` : ""}
        <ul class="ing-list">
          ${r.ingredients.map((x) => `<li class="${x.have ? "have" : "miss"}">
            <span class="dot">${x.have ? icon("check") : icon("cart")}</span>
            <span class="name">${esc(x.name)} ${x.optional ? `<span class="opt">(선택)</span>` : ""}</span>
            <span class="qty">${esc(x.amount || "")}</span>
            <span class="sr-only">${x.have ? "있음" : "없음"}</span>
          </li>`).join("")}
        </ul>
      </section>
    </aside>

    <section aria-labelledby="steps-t">
      <h2 class="section-title" id="steps-t">만드는 순서</h2>
      ${hasSteps ? `
        <ol class="steps">${r.steps.map((s, i) => stepHtml(s, i, skill)).join("")}</ol>
        <div style="margin-top:20px"><button class="btn btn-primary btn-block" data-act="cook" data-v="${esc(r.id)}" data-key="cook">${icon("play")} 요리 시작 (한 단계씩 보기)</button></div>
      ` : state.detailError ? `
        <div class="empty"><h2>조리 순서를 불러오지 못했어요</h2><p>${esc(state.detailError)}</p><button class="btn btn-primary" data-act="retry-detail" data-key="retry-detail">다시 시도</button></div>
      ` : `<div class="loading"><img src="assets/cooking.svg" alt=""><p>GPT가 ${SKILLS[skill].label}에 맞춰 조리 순서를 쓰고 있어요…</p></div>`}

      <section class="card note-card" aria-labelledby="note-t">
        <h2 class="section-title" id="note-t">${icon("edit")} 이렇게 했더니 맛있더라</h2>
        <p class="muted small">내가 바꾼 양념이나 요령을 적어 두면 나만의 레시피로 저장돼요.${aiMode(state.store) === "ai" ? " 다음 추천 때 AI가 내 입맛을 참고해요." : ""}</p>
        <textarea class="textarea" id="note-input" data-key="note-input" placeholder="예: 설탕 대신 올리고당 1큰술, 양파를 더 넣으니 달달하고 좋았다"></textarea>
        <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;align-items:center">
          <span class="muted small" aria-hidden="true"><kbd>Ctrl</kbd> + <kbd>Enter</kbd></span>
          <button class="btn btn-primary" data-act="save-note" data-v="${esc(r.id)}" data-key="save-note">나만의 레시피로 저장</button>
        </div>
        ${notes.length ? `<ul class="note-list">${notes.map((n) => `<li><time>${fmtDate(n.date)}</time>${esc(n.text)}</li>`).join("")}</ul>` : ""}
      </section>

      ${r.source === "ai" ? `<p class="ai-note">${icon("info")}AI가 만든 레시피예요. 간과 익힘 정도는 직접 확인해 주세요.</p>` : ""}
    </section>
  </div>`;
}

function stepHtml(s, i, skill) {
  return `<li class="step">
    <span class="no" aria-hidden="true">${i + 1}</span>
    <div>
      <h3><span class="sr-only">${i + 1}단계. </span>${esc(s.title)}</h3>
      <p>${esc(s.instruction)}</p>
      ${s.heat || s.timer_seconds ? `<span class="heat">${s.heat ? `${icon("flame")}${esc(s.heat)}` : ""}${s.timer_seconds ? ` ${icon("timer")}약 ${Math.round(s.timer_seconds / 60) || 1}분` : ""}</span>` : ""}
      ${skill !== "advanced" && s.done_when ? `<div class="done-when">${icon("check")}<span><b>이렇게 되면 다음으로</b> · ${esc(s.done_when)}</span></div>` : ""}
      ${skill === "beginner" && s.tip ? `<div class="tip">${icon("bulb")}<span>${esc(s.tip)}</span></div>` : ""}
    </div>
  </li>`;
}

async function ensureDetail(id) {
  const r = findRecipe(id);
  if (!r || r.steps?.length || state.detailLoading || state.detailError) return;
  state.detailLoading = true;
  try {
    const full = await detail({ store: state.store, profile: profile(), pantry: pantry(), recipe: r, recipes: state.data.recipes });
    cacheRecipe(full);
  } catch (e) {
    console.error(e);
    state.detailError = e?.message || "잠시 후 다시 시도해 주세요.";
  } finally {
    state.detailLoading = false;
    if (state.route.name === "recipe" && state.route.param === id) render();
  }
}

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
  const skill = profile().skill;
  const mm = String(Math.floor(cook.left / 60)).padStart(2, "0");
  const ss = String(cook.left % 60).padStart(2, "0");
  overlayRoot.innerHTML = `
  <div class="cook" role="dialog" aria-modal="true" aria-labelledby="cook-t">
    <div class="cook-top">
      <button class="icon-btn" data-act="cook-close" aria-label="요리 모드 닫기">${icon("x")}</button>
      <div class="progress" role="progressbar" aria-valuemin="1" aria-valuemax="${r.steps.length}" aria-valuenow="${cook.i + 1}" aria-label="진행 단계"><i style="width:${((cook.i + 1) / r.steps.length) * 100}%"></i></div>
      <span class="muted small">${cook.i + 1} / ${r.steps.length}</span>
    </div>
    <div class="cook-main">
      <div class="stepno">${esc(r.title)} · ${cook.i + 1}단계</div>
      <h2 id="cook-t">${esc(s.title)}</h2>
      <p class="big">${esc(s.instruction)}</p>
      ${s.heat ? `<p class="muted" style="margin-top:8px;display:flex;gap:6px;align-items:center">${icon("flame")} 불 세기: ${esc(s.heat)}</p>` : ""}
      ${skill !== "advanced" && s.done_when ? `<div class="done-when">${icon("check")}<span><b>이렇게 되면 다음으로</b> · ${esc(s.done_when)}</span></div>` : ""}
      ${skill === "beginner" && s.tip ? `<div class="tip">${icon("bulb")}<span>${esc(s.tip)}</span></div>` : ""}
      ${s.timer_seconds ? `<div class="timer ${cook.left === 0 && s.timer_seconds ? "ring" : ""}">
        <span class="t" aria-live="off">${mm}:${ss}</span>
        <button class="btn btn-ghost" data-act="cook-timer" data-key="cook-timer">${cook.running ? `${icon("pause")} 멈춤` : cook.left === 0 ? "다시" : `${icon("timer")} 타이머 시작`}</button>
      </div>` : ""}
    </div>
    <div>
      <div class="cook-bottom">
        <button class="btn btn-ghost" data-act="cook-prev" ${cook.i === 0 ? "disabled" : ""}>${icon("back")} 이전</button>
        <button class="btn btn-primary" data-act="${last ? "cook-done" : "cook-next"}" data-key="cook-next">${last ? `${icon("check")} 요리 완료` : `다음 단계 ${icon("next")}`}</button>
      </div>
      <p class="cook-hint">키보드: ← → 단계 이동 · Space 타이머 · Esc 닫기</p>
    </div>
  </div>`;
  const target = overlayRoot.querySelector('[data-key="cook-next"]');
  target?.focus();
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
  if (cook.left === 0) { resetTimer(); }
  cook.running = !cook.running;
  clearInterval(cook.tick);
  if (cook.running) {
    cook.tick = setInterval(() => {
      cook.left = Math.max(0, cook.left - 1);
      if (cook.left === 0) {
        clearInterval(cook.tick);
        cook.running = false;
        navigator.vibrate?.([200, 100, 200]);
        toast("⏰ 시간이 다 됐어요!");
      }
      renderCookTimerOnly();
    }, 1000);
  }
  renderCook();
}

function renderCookTimerOnly() {
  const t = overlayRoot.querySelector(".timer");
  if (!t) return;
  const mm = String(Math.floor(cook.left / 60)).padStart(2, "0");
  const ss = String(cook.left % 60).padStart(2, "0");
  t.querySelector(".t").textContent = `${mm}:${ss}`;
  if (cook.left === 0) renderCook();
}

async function finishCook() {
  const r = cook.recipe;
  const servings = r.servings || profile().servings;
  closeOverlay();
  await state.store.addCook({ id: uid(), recipeId: r.id, title: r.title, emoji: r.emoji || "🍽️", servings, date: Date.now() });
  toast(`집밥 기록 완료! 외식비 기준 약 ${won(profile().eatOutPrice * servings)} 아꼈어요`);
  render();
  setTimeout(() => $("#note-input")?.focus(), 50);
}

function closeOverlay() {
  if (cook.tick) clearInterval(cook.tick);
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
  const saved = meals * profile().eatOutPrice;
  const recipes = state.data.recipes;
  const fav = recipes.filter((r) => r.favorite);
  const mine = recipes.filter((r) => r.notes?.length);
  const tab = state.myTab;

  const list = tab === "fav" ? fav : tab === "mine" ? mine : null;

  return `${banners()}
  <header class="page-head"><div><h1 class="page-title">내 레시피</h1><p class="page-sub">즐겨찾기와 내가 다듬은 레시피를 모아 봤어요.</p></div></header>

  <section class="savings" aria-label="이번 달 절약">
    <div class="k">${now.getMonth() + 1}월에 집밥으로 아낀 돈</div>
    <div class="v">${won(saved)}</div>
    <div class="s">집밥 ${monthCooks.length}번 · ${meals}끼 · 외식 1끼 ${won(profile().eatOutPrice)} 기준 (설정에서 바꿀 수 있어요)</div>
  </section>

  <div class="section">
    <div class="seg" role="group" aria-label="목록 고르기">
      <button data-act="my-tab" data-v="fav" data-key="my-fav" aria-pressed="${tab === "fav"}">즐겨찾기 ${fav.length}</button>
      <button data-act="my-tab" data-v="mine" data-key="my-mine" aria-pressed="${tab === "mine"}">나만의 레시피 ${mine.length}</button>
      <button data-act="my-tab" data-v="log" data-key="my-log" aria-pressed="${tab === "log"}">요리 기록 ${cooks.length}</button>
    </div>
  </div>

  <div class="section" style="margin-top:16px">
    ${list ? (list.length ? `<div class="recipe-grid">${list.map((r, i) => cardHtml(annotate(r, pantry()), i)).join("")}</div>` : `
      <div class="empty">
        <img src="assets/empty-recipes.svg" alt="">
        <h2>${tab === "fav" ? "즐겨찾기한 레시피가 없어요" : "아직 나만의 레시피가 없어요"}</h2>
        <p>${tab === "fav" ? "레시피 화면에서 ☆을 누르면 여기에 모여요." : "요리 후 '이렇게 했더니 맛있더라'를 적으면 나만의 레시피가 돼요."}</p>
        <a class="btn btn-primary" href="#/recommend">${icon("sparkle")} 추천 요리 보기</a>
      </div>`) : (cooks.length ? `
      <ul class="history">${cooks.slice(0, 100).map((c) => `<li><span>${esc(c.emoji || "🍽️")} ${esc(c.title)} <span class="muted small">${c.servings}인분</span></span><time>${fmtDate(c.date)}</time></li>`).join("")}</ul>` : `
      <div class="empty">
        <img src="assets/empty-recipes.svg" alt="">
        <h2>아직 요리 기록이 없어요</h2>
        <p>레시피에서 '요리 시작'을 누르고 끝까지 따라 하면 기록돼요.</p>
      </div>`)}
  </div>`;
}

// ───────── 설정 ─────────

function viewSettings() {
  const p = profile();
  const cloud = state.store.mode === "cloud";
  const ai = aiMode(state.store) === "ai";
  return `${banners()}
  <header class="page-head"><div><h1 class="page-title">설정</h1></div></header>

  <div class="settings-group">
    <h2>요리</h2>
    <div class="settings-card">
      <div class="setting">
        <div><div class="t">요리 실력</div><div class="d">${SKILLS[p.skill].desc}</div></div>
        <div class="seg" role="group" aria-label="요리 실력">
          ${Object.entries(SKILLS).map(([id, s]) => `<button data-act="set-skill" data-v="${id}" data-key="set-skill-${id}" aria-pressed="${p.skill === id}">${s.emoji} ${s.label}</button>`).join("")}
        </div>
      </div>
      <div class="setting"><div class="head"><div class="t">기본 인분</div>${stepper("servings", p.servings, "인분")}</div></div>
      <div class="setting">
        <div><div class="t">빼고 싶은 재료</div><div class="d">알레르기나 싫어하는 재료는 추천에서 빠져요.</div></div>
        ${tagEditor("excluded", "예: 땅콩, 오이")}
      </div>
    </div>
  </div>

  <div class="settings-group">
    <h2>절약 계산</h2>
    <div class="settings-card">
      <div class="setting">
        <div class="head">
          <label class="t" for="eat-out">외식 1끼 평균 금액</label>
          <input class="input" id="eat-out" data-key="eat-out" type="number" inputmode="numeric" min="0" step="500" value="${p.eatOutPrice}" style="max-width:140px;text-align:right">
        </div>
        <div class="d">요리를 완료할 때마다 이 금액 × 인분만큼 아낀 것으로 계산해요.</div>
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
          <span><kbd>1</kbd>~<kbd>4</kbd></span><span>메뉴 이동 (내 재료 · 추천 · 내 레시피 · 설정)</span>
          <span><kbd>/</kbd></span><span>재료 입력칸으로 바로 가기</span>
          <span><kbd>Tab</kbd></span><span>다음 버튼으로 이동, <kbd>Enter</kbd>/<kbd>Space</kbd>로 누르기</span>
          <span><kbd>Esc</kbd></span><span>뒤로 가기 · 창 닫기</span>
          <span><kbd>←</kbd> <kbd>→</kbd></span><span>요리 모드에서 단계 이동</span>
        </div>
      </div>
    </div>
  </div>

  <div class="settings-group">
    <h2>연결 상태</h2>
    <div class="settings-card">
      <div class="setting"><div class="head"><div><div class="t">${icon(cloud ? "cloud" : "device", "").replace("<svg", '<svg style="width:18px;height:18px;display:inline;vertical-align:-3px;margin-right:6px"')}저장 위치</div><div class="d">${cloud ? "Firebase 클라우드에 저장돼요. 브라우저 데이터를 지워도 남아요." : "이 브라우저에만 저장돼요. 브라우저 기록을 지우면 사라질 수 있어요."}</div></div><span class="badge ${cloud ? "" : "warn"}"><span class="status-dot ${cloud ? "ok" : ""}"></span>${cloud ? "클라우드" : "이 기기"}</span></div></div>
      <div class="setting"><div class="head"><div><div class="t">${icon("sparkle").replace("<svg", '<svg style="width:18px;height:18px;display:inline;vertical-align:-3px;margin-right:6px"')}요리 추천</div><div class="d">${ai ? "GPT가 내 재료·실력·시간에 맞춰 실시간으로 추천해요." : "예시 레시피 16개 안에서 골라요. AI 서버를 연결하면 GPT 추천이 켜져요."}</div></div><span class="badge ${ai ? "" : "warn"}"><span class="status-dot ${ai ? "ok" : ""}"></span>${ai ? "GPT 연결됨" : "예시 모드"}</span></div></div>
    </div>
  </div>

  <div class="settings-group">
    <h2>데이터</h2>
    <div class="settings-card">
      <div class="setting"><div class="head"><div><div class="t">내 데이터 내려받기</div><div class="d">재료·레시피·기록을 파일(JSON)로 저장해요.</div></div><button class="btn btn-ghost btn-sm" data-act="export" data-key="export">${icon("download")} 내려받기</button></div></div>
      <div class="setting"><div class="head"><div><div class="t">처음 설정 다시 하기</div></div><button class="btn btn-ghost btn-sm" data-act="redo-onb" data-key="redo-onb">다시 하기</button></div></div>
      <div class="setting"><div class="head"><div><div class="t">모든 데이터 지우기</div><div class="d">되돌릴 수 없어요.</div></div><button class="btn btn-danger btn-sm" data-act="reset" data-key="reset">${icon("trash")} 지우기</button></div></div>
    </div>
  </div>
  <p class="muted small" style="text-align:center;margin-top:32px">식비를 줄여라 · 베타</p>`;
}

function confirmSheet({ title, body, ok, danger }) {
  return new Promise((resolve) => {
    overlayRoot.innerHTML = `<div class="scrim" data-act="sheet-cancel">
      <div class="sheet" role="alertdialog" aria-modal="true" aria-labelledby="sheet-t" aria-describedby="sheet-d">
        <h2 id="sheet-t">${title}</h2><p id="sheet-d">${body}</p>
        <div class="row">
          <button class="btn btn-ghost" data-act="sheet-cancel">취소</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="sheet-ok">${ok}</button>
        </div>
      </div></div>`;
    overlayRoot.querySelector('[data-act="sheet-cancel"].btn').focus();
    sheetResolve = (v) => { overlayRoot.innerHTML = ""; sheetResolve = null; resolve(v); };
  });
}
let sheetResolve = null;

// ───────── 이벤트 ─────────

const actions = {
  "onb-next": () => { state.onbStep++; render({ focusMain: true }); },
  "onb-prev": () => { state.onbStep = Math.max(0, state.onbStep - 1); render({ focusMain: true }); },
  "onb-done": async () => {
    await saveProfile({ onboarded: true });
    state.onbStep = 0;
    state.route = { name: "pantry", param: "" };
    if (location.hash !== "#/pantry") location.hash = "#/pantry"; else render({ focusMain: true });
  },
  "set-skill": async (el) => { await saveProfile({ skill: el.dataset.v }); render(); },
  step: async (el) => {
    const f = el.dataset.field;
    const v = Math.min(8, Math.max(1, profile()[f] + Number(el.dataset.d)));
    await saveProfile({ [f]: v });
    render();
  },
  "add-tag": async (el) => {
    const f = el.dataset.field;
    const input = $(`#tag-${f}`);
    const items = input.value.split(/[,，、]/).map(norm).filter(Boolean);
    if (!items.length) return input.focus();
    await saveProfile({ [f]: [...new Set([...profile()[f], ...items])] });
    render();
    $(`#tag-${f}`)?.focus();
  },
  "del-tag": async (el) => {
    const f = el.dataset.field;
    await saveProfile({ [f]: profile()[f].filter((t) => t !== el.dataset.v) });
    render();
  },
  "toggle-item": (el) => {
    const name = el.dataset.v;
    const list = pantry();
    const exists = list.some((p) => p.name === name);
    savePantry(exists ? list.filter((p) => p.name !== name) : [...list, { name, kind: el.dataset.kind || "fridge", useFirst: false }]);
    const again = main.querySelector(`[data-key="item-${CSS.escape(name)}"]`);
    if (again && !exists) again.classList.add("pop");
  },
  first: (el) => {
    savePantry(pantry().map((p) => (p.name === el.dataset.v ? { ...p, useFirst: !p.useFirst } : p)));
  },
  "add-pantry": addPantryFromInput,
  "go-recommend": () => go("recommend"),
  time: (el) => { state.time = el.dataset.v; render(); },
  servings: (el) => { state.servings = Number(el.dataset.v); render(); },
  retry: () => ensureResults(true),
  "retry-detail": () => { state.detailError = null; render(); },
  back: () => { if (history.length > 1) history.back(); else go("recommend"); },
  fav: async (el) => {
    const r = findRecipe(el.dataset.v);
    if (!r) return;
    const now = !savedVersion(r.id)?.favorite;
    await upsertSaved(r, { favorite: now });
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
  "cook-close": () => closeOverlay(),
  "cook-prev": () => cookMove(-1),
  "cook-next": () => cookMove(1),
  "cook-timer": () => toggleTimer(),
  "cook-done": () => finishCook(),
  "my-tab": (el) => { state.myTab = el.dataset.v; render(); },
  theme: async (el) => { await saveProfile({ theme: el.dataset.v }); applyTheme(el.dataset.v); render(); },
  export: () => {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `식비를줄여라-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  "redo-onb": async () => { await saveProfile({ onboarded: false }); state.onbStep = 0; render({ focusMain: true }); },
  reset: async () => {
    const ok = await confirmSheet({ title: "모든 데이터를 지울까요?", body: "고른 재료, 즐겨찾기, 나만의 레시피, 요리 기록이 모두 사라지고 되돌릴 수 없어요.", ok: "모두 지우기", danger: true });
    if (!ok) return;
    await state.store.resetAll();
    state.data = state.store.data;
    state.results = null; state.resultsKey = ""; state.cache.clear();
    applyTheme("system");
    toast("모든 데이터를 지웠어요");
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
  if (fn) { e.preventDefault(); fn(el); }
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

  if (typing && e.key === "Enter" && t.dataset.enter) {
    e.preventDefault();
    if (t.dataset.enter === "add-pantry") addPantryFromInput();
    else actions[t.dataset.enter]?.(t);
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
    else if (e.key === "Escape") { e.preventDefault(); closeOverlay(); main.querySelector('[data-key="cook"]')?.focus(); }
    else if (e.key === "Tab") trapFocus(e, overlayRoot.querySelector(".cook"));
    return;
  }
  if (sheetResolve) {
    if (e.key === "Escape") sheetResolve(false);
    else if (e.key === "Tab") trapFocus(e, overlayRoot.querySelector(".sheet"));
    return;
  }

  if (typing) {
    if (e.key === "Escape") t.blur();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!profile().onboarded) return;

  const n = Number(e.key);
  if (n >= 1 && n <= 4) { e.preventDefault(); go(TABS[n - 1].id); return; }
  if (e.key === "/") {
    e.preventDefault();
    if (state.route.name !== "pantry") go("pantry");
    setTimeout(() => $("#pantry-input")?.focus(), 0);
    return;
  }
  if (e.key === "Escape" && state.route.name === "recipe") { e.preventDefault(); actions.back(); }
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
  const { store, error } = await openStore();
  state.store = store;
  state.data = store.data;
  state.storeError = error;
  restoreCache();
  applyTheme(state.data.profile.theme);
  state.route = parseRoute();
  render();
})();
