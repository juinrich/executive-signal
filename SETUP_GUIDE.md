# 🚀 Executive Signal — 배포 셋업 가이드

## 전체 아키텍처

```
[랜딩페이지 (Vercel)]
      │
      ├─ Google 로그인 (Firebase Auth)
      │
      ├─ 샘플 요청 ──────────────────────→ [n8n] sample-request webhook
      │                                         └─ 구글 시트에서 최신 데이터 조회
      │                                         └─ 샘플 HTML 이메일 발송
      │
      └─ 결제 버튼 클릭
            │
            ├─ [토스페이먼츠] requestBillingAuth
            │
            └─ success.html (authKey, customerKey 수신)
                    │
                    └─ [n8n] payment-success webhook
                          ├─ Toss API: 빌링키 발급
                          ├─ Toss API: 첫 결제 실행
                          ├─ 구글 시트 '구독자' 시트에 저장
                          └─ 환영 이메일 발송

[n8n 일일 스케줄]
  └─ 매일 07:32 DART API 조회
  └─ XML 파싱 & 필터링
  └─ 구글 시트 저장
  └─ [TODO] 구독자 시트에서 이메일 목록 읽어 전체 발송
```

---

## Step 1. Firebase 프로젝트 생성 (10분)

1. https://console.firebase.google.com 접속
2. **프로젝트 추가** → 프로젝트 이름: `executive-signal`
3. Google 애널리틱스: 사용 안함 선택
4. 좌측 메뉴 **Authentication** → 시작하기 → **Google** 로그인 방식 활성화
5. 좌측 상단 톱니바퀴(⚙️) → **프로젝트 설정** → **내 앱** → 웹 앱 추가(</>)
6. 앱 닉네임: `executive-signal-web` → **앱 등록**
7. **SDK 구성 및 초기화** 화면에서 아래 값 복사:

```js
// script.js 의 firebaseConfig 에 붙여넣기
const firebaseConfig = {
  apiKey:            "AIzaSy...",       // ← 복사
  authDomain:        "executive-signal-xxxxx.firebaseapp.com",
  projectId:         "executive-signal-xxxxx",
  storageBucket:     "executive-signal-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123...:web:abc..."
};
```

8. **Authentication → Settings → 승인된 도메인** 에 배포 후 Vercel 도메인 추가
   예: `executive-signal.vercel.app`

---

## Step 2. 토스페이먼츠 설정 (15분)

### 테스트 단계 (지금 바로 가능)
- `script.js`의 `TOSS_CLIENT_KEY`는 이미 테스트 키가 설정되어 있음
- 실제 카드 결제 없이 테스트 가능 (테스트 카드번호: 4242-4242-4242-4242)

### n8n에 Toss 시크릿 키 등록
1. n8n → **Credentials** → 새 자격증명 → **HTTP Basic Auth**
2. 이름: `Toss Payments Secret Key`
3. Username: `test_sk_D5b9pwE1jn4R6o96A593RG9O5Xma`
4. Password: (빈칸)
5. 저장 후 `n8n_payment_processor.json` 의 `TOSS_SECRET_KEY_CREDENTIAL_ID` 부분에 연결

### 실서비스 전환 시
- 토스페이먼츠 대시보드 → 라이브 키 발급
- `script.js`: `test_ck_...` → `live_ck_...` 로 교체
- n8n 자격증명: `test_sk_...` → `live_sk_...` 로 교체

---

## Step 3. Google Sheets 구독자 시트 생성

기존 스프레드시트 (ID: `1nueWW4wfhtx2-HnadhbIWWRMcxMOfNYWZEqcpYcww94`) 에
새 시트 추가:

1. 스프레드시트 열기 → 하단 **+** 클릭 → 시트 이름: **구독자**
2. 첫 행에 헤더 입력 (A1부터):

```
이메일 | 플랜 | 결제금액 | 구독시작일 | 구독만료일 | Firebase_UID | 빌링키 | 주문번호 | 결제키 | 카드사 | 상태 | 등록일시
```

---

## Step 4. n8n 워크플로우 가져오기

### 워크플로우 1: 결제 처리기 (신규)
1. n8n → **Workflows** → **Import from file**
2. `n8n_payment_processor.json` 업로드
3. **Toss_Issue_BillingKey** 와 **Toss_Charge_First_Payment** 노드에 자격증명 연결
4. **Save_Subscriber_To_Sheet** 노드에 Google Sheets 자격증명 연결
5. **Send_Welcome_Email** 노드에 Gmail 자격증명 연결
6. 워크플로우 **활성화 (Active)**

### 워크플로우 2: 샘플 발송기 (기존 교체)
1. 기존 `Executive Signal - Sample Sender` 워크플로우 삭제
2. `n8n_sample_sender.json` 가져오기
3. 자격증명 연결 후 **활성화**

### 워크플로우 3: 일일 리포트 (기존 유지)
- `임원매수리포트260302.json`은 기존 워크플로우 그대로 사용
- **⚠️ 중요 개선 필요**: 현재 `sendTo`에 이메일이 하드코딩되어 있음
- 추후 구독자 시트에서 이메일 목록을 동적으로 읽어 발송하도록 업그레이드 권장

---

## Step 5. Vercel 배포 (5분)

### 준비물
- GitHub 계정
- Vercel 계정 (vercel.com, 무료)

### 배포 절차

```bash
# 1. 로컬 폴더 준비 (아래 파일들)
executive-signal/
├── index.html    ← script.js의 Firebase 설정값 입력 완료 후
├── style.css
├── script.js     ← firebaseConfig 채운 후
├── success.html
├── fail.html
├── slide_1.png   ← 업로드한 이미지 파일들
├── slide_2.png
└── slide_3.png

# 2. GitHub 레포지터리 생성 후 push
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/[아이디]/executive-signal.git
git push -u origin main

# 3. vercel.com → New Project → GitHub 레포 연결 → Deploy
```

### 배포 완료 후
- Vercel에서 도메인 확인 (예: `executive-signal.vercel.app`)
- Firebase Authentication → 승인된 도메인에 위 도메인 추가

---

## Step 6. script.js 최종 설정값 입력

`script.js` 상단의 설정값을 실제 값으로 교체:

```js
const firebaseConfig = {
  apiKey: "여기에 Firebase API 키",
  // ... Firebase Console에서 복사한 값
};

const TOSS_CLIENT_KEY = "test_ck_D5b9pwE1jn4R6o96A593RG9O5Xma"; // 테스트 키 (이미 설정됨)

const N8N_SAMPLE_WEBHOOK_URL  = "https://munjuin.app.n8n.cloud/webhook/sample-request";   // 이미 설정됨
const N8N_PAYMENT_WEBHOOK_URL = "https://munjuin.app.n8n.cloud/webhook/payment-success";  // 이미 설정됨
```

---

## ✅ 최종 체크리스트

- [ ] Firebase 프로젝트 생성 & Google 로그인 활성화
- [ ] `script.js` firebaseConfig 값 입력
- [ ] n8n: Toss 시크릿 키 자격증명 등록
- [ ] n8n: `n8n_payment_processor.json` 가져오기 & 활성화
- [ ] n8n: `n8n_sample_sender.json` 가져오기 & 활성화
- [ ] Google Sheets: '구독자' 시트 생성 & 헤더 입력
- [ ] GitHub 레포 생성 & 이미지 파일 포함하여 push
- [ ] Vercel 배포
- [ ] Firebase 승인 도메인에 Vercel 도메인 추가
- [ ] 테스트 결제 진행 (구독자 시트에 데이터 저장 확인)
- [ ] 샘플 이메일 발송 테스트

---

## 🔄 구독자 전체 발송 (일일 리포트 업그레이드)

현재 일일 리포트는 `sendTo`에 이메일이 고정되어 있습니다.
구독자 전체 발송으로 업그레이드하려면 `HTML_Table_Builder` 다음에
아래 노드를 추가하세요:

1. **Google Sheets Read** → 구독자 시트에서 `상태=ACTIVE` 인 모든 이메일 읽기
2. **Split In Batches** → 이메일별로 분리
3. **Gmail 발송** → 각 구독자에게 개별 발송

필요하시면 이 업그레이드 워크플로우도 만들어 드릴 수 있습니다.

---

## 문의
- 기술 지원이 필요하시면 각 단계별로 다시 문의해 주세요.
