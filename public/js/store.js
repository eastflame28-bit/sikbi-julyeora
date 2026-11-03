// 데이터 저장소. 구글로 로그인하면 Supabase(클라우드), 아니면 이 브라우저(localStorage)에 저장합니다.
//
// Supabase 표 (supabase/schema.sql)
//   user_data   { user_id, profile, pantry }
//   my_recipes  { user_id, id, data }   저장한 레시피(즐겨찾기·메모·영상에서 정리)
//   cooks       { user_id, id, data }   요리 완료 기록

import { config } from "./config.js";

const LS_KEY = "sikbi:v2";

export const DEFAULT_PROFILE = {
  servings: 2,
  excluded: [],
  eatOutPrice: 12000,
  theme: "system",
};

const empty = () => ({ profile: { ...DEFAULT_PROFILE }, pantry: [], recipes: [], cooks: [] });

function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return empty();
    const data = JSON.parse(raw);
    return { ...empty(), ...data, profile: { ...DEFAULT_PROFILE, ...(data.profile || {}) } };
  } catch {
    return empty();
  }
}

function writeLocal(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    /* 저장 공간이 막힌 브라우저(사생활 보호 모드 등)에서는 메모리에만 둔다 */
  }
}

const hasAnything = (d) => d.pantry.length || d.recipes.length || d.cooks.length;

class LocalStore {
  mode = "local";
  user = null;
  async init() {
    this.data = readLocal();
    return this.data;
  }
  #flush() { writeLocal(this.data); }
  async saveProfile(profile) { this.data.profile = profile; this.#flush(); }
  async savePantry(pantry) { this.data.pantry = pantry; this.#flush(); }
  async putRecipe(recipe) {
    this.data.recipes = [recipe, ...this.data.recipes.filter((r) => r.id !== recipe.id)];
    this.#flush();
  }
  async removeRecipe(id) { this.data.recipes = this.data.recipes.filter((r) => r.id !== id); this.#flush(); }
  async addCook(cook) { this.data.cooks = [cook, ...this.data.cooks]; this.#flush(); }
  async resetAll() { this.data = empty(); this.#flush(); }
}

class CloudStore {
  mode = "cloud";
  constructor(sb, user) { this.sb = sb; this.user = user; }

  async init() {
    const [u, r, c] = await Promise.all([
      this.sb.from("user_data").select("profile, pantry").maybeSingle(),
      this.sb.from("my_recipes").select("data").order("updated_at", { ascending: false }),
      this.sb.from("cooks").select("data").order("created_at", { ascending: false }).limit(300),
    ]);
    for (const res of [u, r, c]) if (res.error) throw res.error;
    this.data = {
      profile: { ...DEFAULT_PROFILE, ...(u.data?.profile || {}) },
      pantry: u.data?.pantry || [],
      recipes: r.data.map((x) => x.data),
      cooks: c.data.map((x) => x.data),
    };

    // 처음 로그인하면 이 기기에 쓰던 데이터를 계정으로 옮긴다
    const local = readLocal();
    if (!u.data && hasAnything(local)) {
      this.data = { ...local, profile: { ...DEFAULT_PROFILE, ...local.profile } };
      await this.#saveUser();
      if (local.recipes.length) await this.#check(this.sb.from("my_recipes").upsert(local.recipes.map((x) => ({ id: x.id, data: x }))));
      if (local.cooks.length) await this.#check(this.sb.from("cooks").upsert(local.cooks.map((x) => ({ id: x.id, data: x }))));
      this.migrated = true;
    }
    return this.data;
  }

  async #check(q) { const { error } = await q; if (error) throw error; }
  #saveUser() {
    return this.#check(this.sb.from("user_data").upsert({
      user_id: this.user.id, profile: this.data.profile, pantry: this.data.pantry, updated_at: new Date().toISOString(),
    }));
  }
  async saveProfile(profile) { this.data.profile = profile; await this.#saveUser(); }
  async savePantry(pantry) { this.data.pantry = pantry; await this.#saveUser(); }
  async putRecipe(recipe) {
    this.data.recipes = [recipe, ...this.data.recipes.filter((r) => r.id !== recipe.id)];
    await this.#check(this.sb.from("my_recipes").upsert({ id: recipe.id, data: recipe, updated_at: new Date().toISOString() }));
  }
  async removeRecipe(id) {
    this.data.recipes = this.data.recipes.filter((r) => r.id !== id);
    await this.#check(this.sb.from("my_recipes").delete().eq("id", id));
  }
  async addCook(cook) {
    this.data.cooks = [cook, ...this.data.cooks];
    await this.#check(this.sb.from("cooks").insert({ id: cook.id, data: cook }));
  }
  async resetAll() {
    await Promise.all(["my_recipes", "cooks", "user_data"].map((t) => this.#check(this.sb.from(t).delete().eq("user_id", this.user.id))));
    this.data = empty();
  }
}

// ───────── Supabase 연결과 로그인 ─────────

let client = null;

export async function supabase() {
  if (!config.supabase) return null;
  if (!client) {
    const { createClient } = await import(config.supabaseSdk);
    client = createClient(config.supabase.url, config.supabase.anonKey, {
      auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true },
    });
  }
  return client;
}

export async function signInWithGoogle() {
  const sb = await supabase();
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
}

export async function signOut() {
  const sb = await supabase();
  await sb?.auth.signOut();
}

// 로그인돼 있으면 클라우드, 아니면 이 기기. 클라우드 연결에 실패하면 error를 함께 돌려줘 화면에 알린다.
export async function openStore() {
  let sb = null;
  try {
    sb = await supabase();
    if (sb) {
      const { data } = await sb.auth.getSession();
      // 구글 로그인에서 돌아오면 주소에 남은 ?code=… 를 지운다
      if (location.search.includes("code=")) history.replaceState(null, "", location.pathname + location.hash);
      const user = data.session?.user;
      if (user) {
        const cloud = new CloudStore(sb, user);
        await cloud.init();
        return { store: cloud, error: null };
      }
    }
  } catch (err) {
    console.error("Supabase 연결 실패", err);
    const local = new LocalStore();
    await local.init();
    return { store: local, error: err };
  }
  const local = new LocalStore();
  await local.init();
  return { store: local, error: null };
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
