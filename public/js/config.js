// 앱 설정. Supabase 프로젝트를 만든 뒤 아래 값을 채우면 구글 로그인, 클라우드 저장, 공용 레시피 창고가 켜집니다.
// 자세한 순서는 저장소의 설정안내.md를 보세요.

export const config = {
  // Supabase 대시보드 → Project Settings → API 에서 복사한 값. 비워 두면 이 기기(브라우저)에만 저장합니다.
  // anonKey(공개용 키, publishable key)는 비밀번호가 아니라 공개해도 되는 값입니다. 데이터는 schema.sql의 보안 규칙(RLS)이 지킵니다.
  supabase: {
    url: "https://aemtdhwwazeauqsqahcv.supabase.co",
    anonKey: "sb_publishable_BhGXBb_DjIzNAfd0SAyDRQ_RBkbAPqE",
  },
  // 예시:
  // supabase: {
  //   url: "https://abcdefgh.supabase.co",
  //   anonKey: "eyJhbGciOi...",
  // },

  // 레시피 화면의 '조회 수 많은 영상 2개'에 쓰는 YouTube Data API 키.
  // Google Cloud에서 이 웹사이트 주소로만 쓰도록 제한한 키라 공개돼도 됩니다. 비워 두면 유튜브 검색 바로가기만 보여요.
  youtubeApiKey: null,

  supabaseSdk: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm",
};
