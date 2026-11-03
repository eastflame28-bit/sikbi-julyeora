# 식비를 줄여라

> 냉장고 속 재료로 오늘 한 끼, 자신 있게.

집에 있는 양념과 냉장고 재료를 고르면, **내 요리 실력**과 **가진 시간**에 맞춰 지금 만들 수 있는 요리를 추천하는 웹앱입니다. 직접 해 보고 "이렇게 했더니 맛있더라"를 적어 두면 **나만의 레시피**로 쌓입니다.

![식비를 줄여라](public/assets/og.png)

## 주요 기능

| 기능 | 설명 |
|---|---|
| 재료 고르기 | 양념·장·액젓·채소·단백질 등 60여 가지를 눌러서 고르고, 목록에 없는 재료는 직접 입력 |
| 먼저 쓸 재료 | ☆ 표시한 재료를 쓰는 요리를 먼저 추천 |
| 요리 추천 | 바로 만들 수 있는 요리 / 1~2가지만 더 있으면 되는 요리로 나눠 보여 줌 |
| 실력 단계 | 초보·중급·숙련자에 따라 설명 깊이(완료 기준, 요령)가 달라짐 |
| 조리 시간 | 5분 / 15분 / 30분 / 여유 있게 |
| 요리 모드 | 한 단계씩 크게 보기, 단계별 타이머, 키보드 ← → 이동 |
| 나만의 레시피 | 요리 후 메모를 남기면 저장되고, AI 추천 때 내 입맛으로 참고 |
| 즐겨찾기 | ☆로 레시피 모아 두기 |
| 절약 계산 | 요리를 완료할 때마다 외식비 기준으로 아낀 금액을 계산 |
| 키보드 조작 | `1`~`4` 메뉴 이동, `/` 재료 입력, `Esc` 뒤로 |
| 반응형 | 휴대폰은 하단 메뉴, 컴퓨터는 왼쪽 메뉴와 2열 레시피 화면 |
| 다크 모드 | 기기 설정을 따르거나 직접 선택 |

## 동작 방식

```
[브라우저: public/]  ──저장──▶  Firebase Firestore (설정 전에는 브라우저 localStorage)
        │
        └──추천 요청──▶  Firebase Cloud Functions (functions/)  ──▶  OpenAI API
                         · OpenAI 키는 서버 비밀 저장소에만
                         · 사용자별 하루 30회 제한
                         · 응답은 JSON 스키마로 고정, 금지 재료 재검사
```

- **설정 전 (지금 상태)**: 데이터는 이 브라우저에만 저장되고, 추천은 앱에 들어 있는 예시 레시피 16개 안에서 고릅니다. 화면에 "예시 레시피 모드"라고 표시됩니다.
- **설정 후**: `public/js/config.js`에 Firebase 값을 넣고 `aiEnabled: true`로 바꾸면 클라우드 저장과 GPT 실시간 추천이 켜집니다. 순서는 [설정안내.md](설정안내.md)를 보세요.

## 폴더 구조

```
public/                웹앱 (빌드 과정 없이 그대로 배포)
  index.html
  styles.css           디자인 토큰(색·간격)과 화면 스타일
  js/app.js            화면 6개와 동작
  js/store.js          저장소 (Firestore / localStorage)
  js/ai.js             추천 (AI 서버 / 예시 레시피)
  js/catalog.js        재료 목록, 이름 맞추기 규칙(진간장=양조간장 등)
  js/demo-recipes.js   예시 레시피 16개
  js/config.js         Firebase·AI 설정
  assets/              로고, 일러스트
functions/             AI 추천 서버 (Firebase Cloud Functions)
firestore.rules        데이터 접근 규칙 (자기 데이터만)
firebase.json          Firebase 배포 설정
```

## 로컬에서 실행

빌드 도구가 없어서 아무 정적 파일 서버로 `public/` 폴더를 열면 됩니다.

```bash
npx serve public
```

## 배포

- `main` 브랜치에 올리면 GitHub Actions가 `public/` 폴더를 GitHub Pages로 배포합니다.
- 유료 서비스로 운영할 때는 GitHub Pages 대신 Firebase Hosting(`firebase deploy --only hosting`)을 권장합니다. GitHub Pages는 상업용 서비스 운영 용도로는 쓰지 않도록 안내하고 있습니다.
