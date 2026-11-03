// 재료 고르기 화면에 보여 줄 기본 재료 목록과 이름 맞추기 규칙

export const CATEGORIES = [
  { id: "basic", label: "기본 양념", emoji: "🧂", kind: "seasoning",
    items: ["소금", "설탕", "식용유", "참기름", "들기름", "통깨", "후추", "다진마늘"] },
  { id: "jang", label: "장·간장", emoji: "🫙", kind: "seasoning",
    items: ["진간장", "양조간장", "국간장", "고추장", "된장", "쌈장"] },
  { id: "sauce", label: "액젓·소스", emoji: "🍶", kind: "seasoning",
    items: ["멸치액젓", "까나리액젓", "굴소스", "맛술", "식초", "올리고당", "케첩", "마요네즈"] },
  { id: "powder", label: "가루", emoji: "🌶️", kind: "seasoning",
    items: ["고춧가루", "밀가루", "부침가루", "전분", "카레가루"] },
  { id: "veg", label: "채소", emoji: "🥬", kind: "fridge",
    items: ["양파", "대파", "마늘", "감자", "당근", "애호박", "오이", "콩나물", "시금치", "버섯", "양배추", "청양고추", "무"] },
  { id: "protein", label: "두부·계란·고기", emoji: "🥚", kind: "fridge",
    items: ["두부", "계란", "돼지고기", "닭고기", "소고기", "참치캔", "어묵", "햄", "스팸"] },
  { id: "etc", label: "기타", emoji: "🍚", kind: "fridge",
    items: ["밥", "김치", "라면", "떡", "김", "우유", "치즈", "국수"] },
];

export const KNOWN = new Map(CATEGORIES.flatMap((c) => c.items.map((n) => [n, c.id])));

// 레시피 재료 이름 → 이것만 있어도 '있음'으로 보는 이름들
const ALIAS = {
  간장: ["간장", "진간장", "양조간장"],
  진간장: ["진간장", "양조간장", "간장"],
  양조간장: ["양조간장", "진간장", "간장"],
  식용유: ["식용유", "카놀라유", "올리브유", "포도씨유", "콩기름"],
  대파: ["대파", "쪽파", "파"],
  파: ["대파", "쪽파", "파"],
  마늘: ["마늘", "다진마늘"],
  다진마늘: ["다진마늘", "마늘"],
  깨: ["통깨", "깨"],
  통깨: ["통깨", "깨"],
  액젓: ["멸치액젓", "까나리액젓", "액젓"],
  멸치액젓: ["멸치액젓", "까나리액젓"],
  햄: ["햄", "스팸"],
  스팸: ["스팸", "햄"],
  버섯: ["버섯", "표고버섯", "느타리버섯", "팽이버섯", "새송이버섯"],
  밥: ["밥", "햇반", "즉석밥"],
};

// 따로 고르지 않아도 있다고 보는 재료
const ALWAYS = new Set(["물"]);

export const norm = (s) => String(s || "").replace(/\s+/g, "").trim();

export function hasIngredient(pantryNames, name) {
  const n = norm(name);
  if (ALWAYS.has(n)) return true;
  const candidates = ALIAS[n] || [n];
  // '양파'가 '파'로 잘못 맞춰지지 않도록 부분 일치는 두 글자 이상일 때만
  return pantryNames.some((p) => candidates.includes(p) || (n.length >= 2 && p.includes(n)) || (p.length >= 2 && n.includes(p)));
}

export function categoryOf(name) {
  return KNOWN.get(norm(name)) || "etc";
}

export function kindOf(name) {
  const cat = CATEGORIES.find((c) => c.id === categoryOf(name));
  return cat ? cat.kind : "fridge";
}
