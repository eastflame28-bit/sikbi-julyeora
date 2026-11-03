// 데이터 저장소. Firebase 설정이 있으면 Firestore(클라우드), 없으면 이 브라우저(localStorage)에 저장합니다.
//
// Firestore 구조
//   users/{uid}                 { profile, pantry, updatedAt }
//   users/{uid}/recipes/{id}    저장한 레시피(즐겨찾기·나만의 레시피)
//   users/{uid}/cooks/{id}      요리 완료 기록

import { config } from "./config.js";

const LS_KEY = "sikbi:v1";

export const DEFAULT_PROFILE = {
  onboarded: false,
  skill: "beginner",
  servings: 2,
  allergies: [],
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

class LocalStore {
  mode = "local";
  async init() {
    this.data = readLocal();
    return this.data;
  }
  #flush() { writeLocal(this.data); }
  async saveProfile(profile) { this.data.profile = profile; this.#flush(); }
  async savePantry(pantry) { this.data.pantry = pantry; this.#flush(); }
  async putRecipe(recipe) {
    const list = this.data.recipes.filter((r) => r.id !== recipe.id);
    this.data.recipes = [recipe, ...list];
    this.#flush();
  }
  async removeRecipe(id) { this.data.recipes = this.data.recipes.filter((r) => r.id !== id); this.#flush(); }
  async addCook(cook) { this.data.cooks = [cook, ...this.data.cooks]; this.#flush(); }
  async resetAll() { this.data = empty(); this.#flush(); }
}

class CloudStore {
  mode = "cloud";
  async init() {
    const v = config.firebaseSdkVersion;
    const base = `https://www.gstatic.com/firebasejs/${v}`;
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-auth.js`),
      import(`${base}/firebase-firestore.js`),
    ]);
    this.fs = fs;
    this.app = initializeApp(config.firebase);
    const a = auth.getAuth(this.app);
    // 저장된 로그인 상태를 먼저 불러와야 새로고침할 때마다 새 익명 계정이 생기지 않는다
    await a.authStateReady();
    const user0 = a.currentUser || (await auth.signInAnonymously(a)).user;
    this.uid = user0.uid;
    this.db = fs.initializeFirestore(this.app, { localCache: fs.persistentLocalCache() });

    const userRef = fs.doc(this.db, "users", this.uid);
    const [userSnap, recipeSnap, cookSnap] = await Promise.all([
      fs.getDoc(userRef),
      fs.getDocs(fs.query(fs.collection(userRef, "recipes"), fs.orderBy("updatedAt", "desc"))),
      fs.getDocs(fs.query(fs.collection(userRef, "cooks"), fs.orderBy("date", "desc"), fs.limit(200))),
    ]);
    const user = userSnap.exists() ? userSnap.data() : {};
    this.data = {
      profile: { ...DEFAULT_PROFILE, ...(user.profile || {}) },
      pantry: user.pantry || [],
      recipes: recipeSnap.docs.map((d) => d.data()),
      cooks: cookSnap.docs.map((d) => d.data()),
    };
    return this.data;
  }
  #user() { return this.fs.doc(this.db, "users", this.uid); }
  async saveProfile(profile) {
    this.data.profile = profile;
    await this.fs.setDoc(this.#user(), { profile, updatedAt: Date.now() }, { merge: true });
  }
  async savePantry(pantry) {
    this.data.pantry = pantry;
    await this.fs.setDoc(this.#user(), { pantry, updatedAt: Date.now() }, { merge: true });
  }
  async putRecipe(recipe) {
    this.data.recipes = [recipe, ...this.data.recipes.filter((r) => r.id !== recipe.id)];
    await this.fs.setDoc(this.fs.doc(this.#user(), "recipes", recipe.id), recipe);
  }
  async removeRecipe(id) {
    this.data.recipes = this.data.recipes.filter((r) => r.id !== id);
    await this.fs.deleteDoc(this.fs.doc(this.#user(), "recipes", id));
  }
  async addCook(cook) {
    this.data.cooks = [cook, ...this.data.cooks];
    await this.fs.setDoc(this.fs.doc(this.#user(), "cooks", cook.id), cook);
  }
  async resetAll() {
    const batch = this.fs.writeBatch(this.db);
    for (const r of this.data.recipes) batch.delete(this.fs.doc(this.#user(), "recipes", r.id));
    for (const c of this.data.cooks) batch.delete(this.fs.doc(this.#user(), "cooks", c.id));
    batch.delete(this.#user());
    await batch.commit();
    this.data = empty();
  }
}

// 클라우드 연결에 실패하면 조용히 넘어가지 않고 error를 함께 돌려줘 화면에 알린다.
export async function openStore() {
  if (config.firebase) {
    const cloud = new CloudStore();
    try {
      await cloud.init();
      return { store: cloud, error: null };
    } catch (err) {
      console.error("Firebase 연결 실패", err);
      const local = new LocalStore();
      await local.init();
      return { store: local, error: err };
    }
  }
  const local = new LocalStore();
  await local.init();
  return { store: local, error: null };
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
