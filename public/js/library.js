// 레시피 도서관: public/data/recipes-XX.txt 에 적어 둔 레시피를 불러와 레시피 객체로 바꾼다.
// 기본 레시피(seed-recipes.js) 100개 외에 더 많은 가정식 레시피를 담는다.
// 파일을 나눠 두고 앱이 처음 열릴 때 한 번에 받아 둔다 (인터넷 사용량을 줄이려고 짧은 글 형식으로 씀).
//
// 형식 (레시피 사이에는 빈 줄):
//   # 제목 | 이모지 | 분류 | 걸리는 분 | 쉬움/보통/어려움 | 인분
//   > 한 줄 소개
//   - 재료 | 양                 (없어도 되는 재료는 '- ?재료 | 양', 대신 쓸 재료는 '- 재료 | 양 | 대체')
//   = 단계 제목 | 설명 | 불 세기 | 타이머(분) | 다음으로 넘어갈 때 | 팁

export const LIBRARY_FILES = Array.from({ length: 6 }, (_, i) => `data/recipes-${String(i + 1).padStart(2, "0")}.txt`);
const DIFF = { 쉬움: "easy", 보통: "medium", 어려움: "hard" };

let all = [];
let byId = new Map();
let loading = null;

// 제목이 같으면 언제나 같은 번호가 나오게 한다 (즐겨찾기·메모가 계속 이어지도록)
export function libraryId(title) {
  let h = 0x811c9dc5;
  for (const ch of String(title).replace(/\s+/g, "")) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return "x-" + h.toString(36);
}

const cell = (s) => { const v = (s ?? "").trim(); return v && v !== "-" ? v : null; };

export function parseRecipes(text) {
  const out = [];
  for (const block of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const head = lines.find((l) => l.startsWith("# "));
    if (!head) continue;
    const [title, emoji, category, minutes, diff, servings] = head.slice(2).split("|").map((s) => s.trim());
    const r = {
      id: libraryId(title), title, emoji: emoji || "🍽️", category: category || "반찬", summary: "",
      servings: Number(servings) || 2, total_minutes: Number(minutes) || 0, difficulty: DIFF[diff] || "easy",
      equipment: [], ingredients: [], steps: [], source: "library",
    };
    for (const l of lines) {
      if (l.startsWith("> ")) r.summary = l.slice(2).trim();
      else if (l.startsWith("- ")) {
        let [name, amount, sub] = l.slice(2).split("|");
        name = name.trim();
        const optional = name.startsWith("?");
        if (optional) name = name.slice(1).trim();
        r.ingredients.push({ name, amount: (amount || "").trim(), optional, substitute: cell(sub) });
      } else if (l.startsWith("= ")) {
        const [t, ins, heat, min, done, tip] = l.slice(2).split("|");
        const m = Number(cell(min));
        r.steps.push({ title: (t || "").trim(), instruction: (ins || "").trim(), heat: cell(heat),
          timer_seconds: m > 0 ? Math.round(m * 60) : null, done_when: cell(done) || "", tip: cell(tip) });
      }
    }
    if (title && r.ingredients.length && r.steps.length) out.push(r);
  }
  return out;
}

// 한 번만 받아 둔다. 파일 하나를 못 받아도 나머지는 쓴다.
export function loadLibrary() {
  if (!loading) {
    loading = Promise.all(LIBRARY_FILES.map((f) => fetch(f).then((r) => (r.ok ? r.text() : "")).catch(() => "")))
      .then((texts) => {
        const seen = new Set();
        all = texts.flatMap(parseRecipes).filter((r) => !seen.has(r.id) && seen.add(r.id));
        byId = new Map(all.map((r) => [r.id, r]));
        return all;
      });
  }
  return loading;
}

export const libraryRecipes = () => all;
export const libraryRecipe = (id) => byId.get(id) || null;
export const libraryReady = () => byId.size > 0;
