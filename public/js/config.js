// 앱 설정. Firebase 프로젝트를 만든 뒤 아래 값을 채우면 클라우드 저장과 AI 추천이 켜집니다.
// 자세한 순서는 저장소의 설정안내.md를 보세요.

export const config = {
  // Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹)에서 복사한 값. 비워 두면 이 기기(브라우저)에만 저장합니다.
  // 웹용 apiKey는 비밀번호가 아니라 프로젝트 식별용이라 공개 저장소에 올려도 됩니다.
  firebase: null,
  // 예시:
  // firebase: {
  //   apiKey: "AIza...",
  //   authDomain: "my-project.firebaseapp.com",
  //   projectId: "my-project",
  //   appId: "1:123:web:abc",
  // },

  // Cloud Functions(recommend 함수)를 배포한 뒤 true로 바꾸면 GPT 추천을 씁니다.
  aiEnabled: false,
  functionsRegion: "asia-northeast3",

  firebaseSdkVersion: "10.14.1",
};
