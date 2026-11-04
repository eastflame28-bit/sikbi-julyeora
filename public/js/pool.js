// 레시피 창고. 앱에 들어 있는 기본 레시피 + 모두가 함께 쌓은 공용 레시피(Supabase recipes 표)에서
// 내 재료로 만들 수 있는 요리를 찾습니다.

import { SEED_RECIPES } from "./seed-recipes.js";
import { BASICS, expandNames, hasIngredient, norm } from "./catalog.js";
import { supabase, uid } from "./store.js";
import { findSwap } from "./subs.js";

// 레시피 재료마다 '있음 / 대신 쓸 수 있음 / 없음'을 표시하고 부족한 필수 재료를 계산한다.
// (AI가 보낸 값도 그대로 믿지 않고 내 재료 목록과 다시 맞춰 본다)
export function annotate(recipe, pantry) {
  const names = pantry.map((p) => norm(p.name));
  const ingredients = recipe.ingredients.map((ing) => {
    const have = hasIngredient(names, ing.name);
    return { ...ing, have, swap: have ? null : findSwap(ing.name, names) };
  });
  const lacking = ingredients.filter((x) => !x.optional && !x.have);
  const missing = lacking.filter((x) => !x.swap).map((x) => x.name);
  const swaps = lacking.filter((x) => x.swap).map((x) => ({ name: x.name, use: x.swap.use }));
  const mainUsed = ingredients.filter((x) => x.have && !BASICS.includes(norm(x.name))).length;
  return { ...recipe, ingredients, missing, swaps, mainUsed };
}

export const isBlocked = (recipe, excluded) => {
  const bad = excluded.map(norm).filter(Boolean);
  return recipe.ingredients.some((ing) => bad.some((b) => norm(ing.name).includes(b)));
};

const fromRow = (row) => ({
  id: row.id, title: row.title, emoji: row.emoji, category: row.category, summary: row.summary,
  servings: row.servings, total_minutes: row.total_minutes, difficulty: row.difficulty,
  equipment: row.equipment || [], ingredients: row.ingredients, steps: row.steps, source: "ai",
});

async function signedIn(sb) {
  const { data } = await sb.auth.getSession();
  const user = data.session?.user;
  return user && !user.is_anonymous ? user : null;
}

export async function fetchStats(ids) {
  const sb = await supabase();
  if (!sb || !ids.length) return new Map();
  const { data, error } = await sb.rpc("recipe_stats", { ids });
  if (error) { console.warn("반응 수를 불러오지 못함", error); return new Map(); }
  return new Map(data.map((s) => [s.recipe_id, { cooks: Number(s.cooks), favs: Number(s.favs) }]));
}

// 반환: { ready: [...], almost: [...], cloud: 공용 창고를 읽었는지 }
export async function findRecipes({ pantry, excluded, extra = [] }) {
  const names = pantry.map((p) => norm(p.name));
  const byId = new Map();
  for (const r of [...SEED_RECIPES, ...extra]) byId.set(r.id, r);

  let cloud = false;
  const sb = await supabase();
  if (sb && names.length) {
    const { data, error } = await sb.from("recipes").select("*")
      .overlaps("ingredient_names", expandNames(names))
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) console.warn("공용 레시피를 불러오지 못함", error);
    else { cloud = true; for (const row of data) if (!byId.has(row.id)) byId.set(row.id, fromRow(row)); }
  }

  const list = [...byId.values()]
    .filter((r) => !isBlocked(r, excluded))
    .map((r) => annotate(r, pantry))
    .filter((r) => r.mainUsed > 0 && r.missing.length <= 2);

  const stats = await fetchStats(list.map((r) => r.id));
  for (const r of list) r.stats = stats.get(r.id) || { cooks: 0, favs: 0 };

  list.sort((a, b) =>
    a.missing.length - b.missing.length ||
    a.swaps.length - b.swaps.length ||
    (b.stats.cooks * 2 + b.stats.favs) - (a.stats.cooks * 2 + a.stats.favs) ||
    b.mainUsed - a.mainUsed ||
    a.total_minutes - b.total_minutes);

  return {
    ready: list.filter((r) => r.missing.length === 0).slice(0, 30),
    almost: list.filter((r) => r.missing.length > 0).slice(0, 20),
    cloud,
  };
}

const fingerprint = (r) => norm(r.title) + "|" + r.ingredients
  .filter((i) => !i.optional && !BASICS.includes(norm(i.name)))
  .map((i) => norm(i.name)).sort().slice(0, 6).join(",");

// AI가 만든 레시피를 공용 창고에 넣는다. 로그인한 경우만. 이미 같은 요리가 있으면 건너뛴다.
export async function shareRecipes(recipes) {
  const sb = await supabase();
  if (!sb || !recipes.length || !(await signedIn(sb))) return false;
  const rows = recipes.map((r) => ({
    id: r.id, fingerprint: fingerprint(r), title: r.title, emoji: r.emoji, category: r.category, summary: r.summary,
    servings: r.servings, total_minutes: r.total_minutes, difficulty: r.difficulty, equipment: r.equipment || [],
    ingredients: r.ingredients.map(({ name, amount, optional, substitute }) => ({ name, amount, optional: !!optional, substitute: substitute ?? null })),
    steps: r.steps, ingredient_names: [...new Set(r.ingredients.map((i) => norm(i.name)))], source: "ai",
  }));
  const { error } = await sb.from("recipes").upsert(rows, { onConflict: "fingerprint", ignoreDuplicates: true });
  if (error) { console.warn("공용 창고에 저장하지 못함", error); return false; }
  return true;
}

// '만들었어요'·'즐겨찾기' 반응. 로그인한 경우만 기록하고, 누가 했는지는 다른 사람에게 보이지 않는다.
export async function markRecipe(recipeId, kind, on) {
  const sb = await supabase();
  const user = sb && (await signedIn(sb));
  if (!user) return;
  const q = on
    ? sb.from("recipe_marks").upsert({ recipe_id: recipeId, kind }, { onConflict: "user_id,recipe_id,kind", ignoreDuplicates: true })
    : sb.from("recipe_marks").delete().match({ recipe_id: recipeId, kind });
  const { error } = await q;
  if (error) console.warn("반응을 저장하지 못함", error);
}

export const newId = (prefix) => `${prefix}-${uid()}`;
