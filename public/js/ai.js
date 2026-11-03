// 요리 추천. AI 서버(Firebase Functions의 recommend)가 켜져 있으면 GPT에 묻고,
// 아니면 예시 레시피 안에서 조건에 맞는 것을 고릅니다.

import { config } from "./config.js";
import { DEMO_RECIPES } from "./demo-recipes.js";
import { hasIngredient, norm } from "./catalog.js";

let callable = null;

export function aiMode(store) {
  return config.aiEnabled && store.mode === "cloud" ? "ai" : "demo";
}

async function callServer(store, payload) {
  if (!callable) {
    const fn = await import(`https://www.gstatic.com/firebasejs/${config.firebaseSdkVersion}/firebase-functions.js`);
    const functions = fn.getFunctions(store.app, config.functionsRegion);
    callable = fn.httpsCallable(functions, "recommend", { timeout: 70000 });
  }
  const res = await callable(payload);
  return res.data;
}

// 레시피 재료 하나하나에 '있음/없음'을 표시하고 부족한 필수 재료를 다시 계산한다.
// (AI가 보낸 값도 그대로 믿지 않고 내 재료 목록과 다시 맞춰 본다)
export function annotate(recipe, pantry) {
  const names = pantry.map((p) => norm(p.name));
  const ingredients = recipe.ingredients.map((ing) => ({
    ...ing,
    have: hasIngredient(names, ing.name),
  }));
  const missing = ingredients.filter((x) => !x.optional && !x.have).map((x) => x.name);
  const used = ingredients.filter((x) => x.have).length;
  const usesFirst = pantry.filter((p) => p.useFirst && ingredients.some((x) => x.have && hasIngredient([norm(p.name)], x.name))).length;
  return { ...recipe, ingredients, missing, used, usesFirst };
}

const blocked = (recipe, profile) => {
  const bad = [...profile.allergies, ...profile.excluded].map(norm).filter(Boolean);
  return recipe.ingredients.some((ing) => bad.some((b) => norm(ing.name).includes(b)));
};

const timeOk = (recipe, time) => time === "free" || recipe.total_minutes <= Number(time);

function sortRecipes(list) {
  return list.sort((a, b) =>
    a.missing.length - b.missing.length ||
    b.usesFirst - a.usesFirst ||
    b.used - a.used ||
    a.total_minutes - b.total_minutes);
}

function myNotesFor(recipes) {
  return recipes
    .filter((r) => r.notes?.length)
    .slice(0, 5)
    .map((r) => ({ title: r.title, note: r.notes[0].text }));
}

// 추천 목록. 반환: { status, message, ready: [...], almost: [...], source }
export async function recommend({ store, profile, pantry, time, servings, recipes }) {
  if (aiMode(store) === "ai") {
    const data = await callServer(store, {
      mode: "list",
      skill_level: profile.skill,
      servings,
      max_total_minutes: time === "free" ? null : Number(time),
      allergens: profile.allergies,
      excluded_ingredients: profile.excluded,
      inventory: pantry.map((p) => ({ name: p.name, use_first: !!p.useFirst })),
      my_notes: myNotesFor(recipes),
    });
    const list = sortRecipes((data.recipes || []).map((r, idx) => annotate({
      ...r,
      id: `ai-${Date.now().toString(36)}-${idx}`,
      emoji: r.emoji || "🍽️",
      source: "ai",
    }, pantry)));
    return {
      status: data.status,
      message: data.message,
      ready: list.filter((r) => r.missing.length === 0),
      almost: list.filter((r) => r.missing.length > 0),
      source: "ai",
    };
  }

  await new Promise((r) => setTimeout(r, 450));
  const list = sortRecipes(DEMO_RECIPES
    .filter((r) => !blocked(r, profile) && timeOk(r, time))
    .map((r) => annotate({ ...r, servings, source: "demo" }, pantry))
    .filter((r) => r.used > 0 && r.missing.length <= 2));
  return {
    status: list.length ? "ok" : "no_match",
    message: null,
    ready: list.filter((r) => r.missing.length === 0),
    almost: list.filter((r) => r.missing.length > 0),
    source: "demo",
  };
}

// 상세 레시피. AI 모드에서는 고른 메뉴 하나만 조리 순서를 새로 받아 온다.
export async function detail({ store, profile, pantry, recipe, recipes }) {
  if (recipe.steps?.length) return recipe;
  const data = await callServer(store, {
    mode: "detail",
    skill_level: profile.skill,
    servings: recipe.servings,
    allergens: profile.allergies,
    excluded_ingredients: profile.excluded,
    inventory: pantry.map((p) => ({ name: p.name, use_first: !!p.useFirst })),
    my_notes: myNotesFor(recipes),
    selected: { title: recipe.title, ingredients: recipe.ingredients.map(({ name, amount, optional }) => ({ name, amount, optional })) },
  });
  const full = data.recipes?.[0];
  if (data.status !== "ok" || !full) {
    throw new Error(data.message || "레시피를 만들지 못했어요.");
  }
  return annotate({ ...recipe, ...full, id: recipe.id, emoji: recipe.emoji, source: "ai" }, pantry);
}
