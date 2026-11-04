// 레시피 영상 추천. YouTube Data API로 '요리 이름 + 레시피'를 검색해
// 관련 있는 영상 10개 중 조회 수가 가장 높은 2개를 고른다.
// 키는 웹사이트 주소로 사용을 제한한 공개용 키(config.youtubeApiKey)를 쓴다.
// 같은 요리는 이 브라우저에 7일 동안 저장해 두고 다시 묻지 않는다 (무료 사용량 아끼기).

import { config } from "./config.js";

const API = "https://www.googleapis.com/youtube/v3";
const CACHE_DAYS = 7;
const PICK = 2;

export const youtubeEnabled = () => !!config.youtubeApiKey;

const cacheKey = (q) => "sikbi:yt:" + q;

function readCache(q) {
  try {
    const v = JSON.parse(localStorage.getItem(cacheKey(q)) || "null");
    return v && Date.now() - v.at < CACHE_DAYS * 86400000 ? v.items : null;
  } catch {
    return null;
  }
}

function writeCache(q, items) {
  try { localStorage.setItem(cacheKey(q), JSON.stringify({ at: Date.now(), items })); } catch { /* 저장이 막혀도 이번에는 보여 준다 */ }
}

// API가 돌려주는 제목에는 &quot; 같은 글자가 섞여 있어 원래 글자로 바꾼다
function decode(s) {
  const t = document.createElement("textarea");
  t.innerHTML = s || "";
  return t.value;
}

async function get(path, params) {
  const url = `${API}/${path}?${new URLSearchParams({ ...params, key: config.youtubeApiKey })}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `YouTube ${res.status}`);
  return data;
}

// 반환: [{ id, title, channel, views, thumb }] (최대 2개)
export async function topVideos(dish) {
  const q = `${dish} 레시피`;
  const cached = readCache(q);
  if (cached) return cached;

  const found = await get("search", {
    part: "snippet", type: "video", q, maxResults: "10",
    order: "relevance", regionCode: "KR", relevanceLanguage: "ko", safeSearch: "strict", videoEmbeddable: "true",
  });
  const ids = (found.items || []).map((x) => x.id?.videoId).filter(Boolean);
  if (!ids.length) { writeCache(q, []); return []; }

  const stats = await get("videos", { part: "statistics,snippet", id: ids.join(",") });
  const items = (stats.items || [])
    .map((v) => ({
      id: v.id,
      title: decode(v.snippet?.title),
      channel: decode(v.snippet?.channelTitle),
      views: Number(v.statistics?.viewCount || 0),
      thumb: v.snippet?.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, PICK);
  writeCache(q, items);
  return items;
}

// 1234567 → "123만회"
export function formatViews(n) {
  if (n >= 1e8) return `${(n / 1e8).toFixed(n >= 1e9 ? 0 : 1).replace(/\.0$/, "")}억회`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, "")}만회`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}천회`;
  return `${n}회`;
}
