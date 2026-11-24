// 레시피 도서관 파일 검사: node tools/check-recipes.mjs
// 겹치는 요리, 빠진 칸, 이상한 분류, 재료 이름 표기를 찾아 알려 준다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const { parseRecipes, LIBRARY_FILES } = await import(pathToFileURL(path.join(root, "js/library.js")));
const { SEED_RECIPES } = await import(pathToFileURL(path.join(root, "js/seed-recipes.js")));

const CATS = ["밥·면", "국·찌개", "반찬", "메인", "전", "간식"];
// 앱의 재료 이름과 맞추기 위해 쓰지 않는 표기
const PREFER = { 달걀: "계란", 간장: "진간장/국간장", 식물성기름: "식용유", 깨: "통깨", 파: "대파/쪽파", 다진파: "대파", 고추가루: "고춧가루" };
const n = (s) => String(s).replace(/\s+/g, "");

const titles = new Map(SEED_RECIPES.map((r) => [n(r.title), "기본"]));
let total = 0, problems = 0;
const warn = (f, t, msg) => { problems++; console.log(`  ⚠ ${f} · ${t}: ${msg}`); };

for (const rel of LIBRARY_FILES) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { console.log(`${rel}: (아직 없음)`); continue; }
  const text = fs.readFileSync(file, "utf8");
  const blocks = text.split(/\n\s*\n/).filter((b) => b.includes("# ")).length;
  const list = parseRecipes(text);
  console.log(`${rel}: ${list.length}개${blocks !== list.length ? ` (읽지 못한 블록 ${blocks - list.length}개)` : ""}`);
  if (blocks !== list.length) problems++;
  for (const r of list) {
    total++;
    const k = n(r.title);
    if (titles.has(k)) warn(rel, r.title, `이미 있는 요리 (${titles.get(k)})`);
    titles.set(k, rel);
    if (!CATS.includes(r.category)) warn(rel, r.title, `분류 '${r.category}'`);
    if (!r.summary) warn(rel, r.title, "소개 없음");
    if (r.steps.length < 2) warn(rel, r.title, `단계 ${r.steps.length}개`);
    if (!r.total_minutes) warn(rel, r.title, "시간 없음");
    for (const i of r.ingredients) {
      if (!i.amount) warn(rel, r.title, `'${i.name}' 양 없음`);
      if (PREFER[n(i.name)]) warn(rel, r.title, `'${i.name}' → ${PREFER[n(i.name)]}`);
    }
    for (const s of r.steps) if (!s.instruction || !s.done_when) warn(rel, r.title, `단계 '${s.title}' 설명/완료 상태 없음`);
  }
}
console.log(`\n기본 ${SEED_RECIPES.length}개 + 도서관 ${total}개 = ${SEED_RECIPES.length + total}개 · 문제 ${problems}개`);
process.exitCode = problems ? 1 : 0;
