// ============================================================
//  Executive Signal — script.js
//  Firebase Google Auth + 토스페이먼츠 빌링 + n8n Webhook 연동
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

// ──────────────────────────────────────────────────────────
//  🔧 [필수 설정] Firebase 프로젝트 값으로 교체하세요
//  Firebase Console → 프로젝트 설정 → 앱 추가(웹) → SDK 스니펫
// ──────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyCq2Tzk2-hhXDBu8bu-uxNozJPZ4NrtoSw",
  authDomain:        "insider-66472.firebaseapp.com",
  projectId:         "insider-66472",
  storageBucket:     "insider-66472.firebasestorage.app",
  messagingSenderId: "729919164559",
  appId:             "1:729919164559:web:5263bd8c9d93e73249e0fa"
};

// ──────────────────────────────────────────────────────────
//  🔧 [필수 설정] 토스페이먼츠 클라이언트 키
//  실서비스: 토스페이먼츠 대시보드 → 개발자센터 → 키 확인
// ──────────────────────────────────────────────────────────
const TOSS_CLIENT_KEY = "test_ck_D5b9pwE1jn4R6o96A593RG9O5Xma";
// 실서비스 전환 시: "live_ck_XXXXXXXXXXXXXXXX" 로 교체

// ──────────────────────────────────────────────────────────
//  🔧 [필수 설정] n8n Webhook URL
//  n8n 워크플로우 활성화 후 생성된 URL을 복사하세요
// ──────────────────────────────────────────────────────────
const N8N_SAMPLE_WEBHOOK_URL  = "https://munjuin.app.n8n.cloud/webhook/sample-request";
const N8N_PAYMENT_WEBHOOK_URL = "https://munjuin.app.n8n.cloud/webhook/payment-success";

// ──────────────────────────────────────────────────────────
//  Firebase 초기화
// ──────────────────────────────────────────────────────────
const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const provider = new GoogleAuthProvider();

// ──────────────────────────────────────────────────────────
//  DOM 요소
// ──────────────────────────────────────────────────────────
const loginBtn   = document.getElementById("auth-login-btn");
const logoutBtn  = document.getElementById("auth-logout-btn");
const userInfo   = document.getElementById("auth-user-info");
const userAvatar = document.getElementById("auth-user-avatar");
const userName   = document.getElementById("auth-user-name");

let currentUser = null;

// ──────────────────────────────────────────────────────────
//  1. Auth 상태 감지 및 UI 업데이트
// ──────────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
  currentUser = user;

  if (user) {
    loginBtn.style.display  = "none";
    userInfo.style.display  = "flex";
    userAvatar.src          = user.photoURL || "";
    userName.textContent    = user.displayName || user.email;

    // 로그인 시 결제 이메일 자동완성
    ["checkout-email", "checkout-email-annual"].forEach((id) => {
      const el = document.getElementById(id);
      if (el && !el.value) el.value = user.email;
    });
  } else {
    loginBtn.style.display = "inline-flex";
    userInfo.style.display = "none";
  }
});

// ──────────────────────────────────────────────────────────
//  2. 로그인 / 로그아웃
// ──────────────────────────────────────────────────────────
loginBtn?.addEventListener("click", () => {
  signInWithPopup(auth, provider).catch((err) => {
    console.error("Google 로그인 오류:", err);
    alert("로그인에 실패했습니다.\n팝업이 차단됐을 수 있습니다. 팝업을 허용해 주세요.");
  });
});

logoutBtn?.addEventListener("click", () => {
  signOut(auth).catch(console.error);
});

// ──────────────────────────────────────────────────────────
//  유틸: 이메일 형식 검증
// ──────────────────────────────────────────────────────────
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ──────────────────────────────────────────────────────────
//  유틸: 성공 팝업 표시
// ──────────────────────────────────────────────────────────
function showPopup(msg) {
  const popup = document.getElementById("sample-popup");
  if (!popup) return;
  if (msg) popup.textContent = msg;
  popup.classList.add("show");
  setTimeout(() => popup.classList.remove("show"), 3500);
}

// ──────────────────────────────────────────────────────────
//  3. 무료 샘플 발송 (n8n Webhook 호출)
// ──────────────────────────────────────────────────────────
const sampleBtn       = document.getElementById("sample-button");
const sampleEmailEl   = document.getElementById("sample-email");
const sampleBtnText   = document.getElementById("sample-btn-text");
const sampleLoader    = document.getElementById("sample-loader");

sampleBtn?.addEventListener("click", async () => {
  const email = sampleEmailEl?.value.trim();
  if (!email || !isValidEmail(email)) {
    alert("유효한 이메일 주소를 입력해주세요.");
    sampleEmailEl?.focus();
    return;
  }

  // 버튼 로딩 상태
  sampleBtn.disabled         = true;
  sampleBtnText.textContent  = "전송 중...";
  sampleLoader.style.display = "inline-block";

  try {
    // 1차 시도: 일반 fetch (CORS 허용 시)
    const resp = await fetch(N8N_SAMPLE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email:     email,
        type:      "FREE_SAMPLE",
        timestamp: new Date().toISOString()
      })
    });

    if (!resp.ok) {
      throw new Error(`서버 응답 오류: ${resp.status}`);
    }

    showPopup("✅ 메일함으로 샘플이 발송되었습니다!");
    sampleEmailEl.value = "";

  } catch (err) {
    console.warn("1차 fetch 실패, no-cors 모드로 재시도:", err.message);

    try {
      // 2차 시도: no-cors 모드 (CORS 차단 우회 — 응답 읽기 불가하지만 요청은 전달됨)
      await fetch(N8N_SAMPLE_WEBHOOK_URL, {
        method: "POST",
        mode:   "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          email:     email,
          type:      "FREE_SAMPLE",
          timestamp: new Date().toISOString()
        })
      });
      // no-cors 는 응답 확인 불가 → 낙관적으로 성공 처리
      showPopup("✅ 메일함으로 샘플이 발송되었습니다!");
      sampleEmailEl.value = "";

    } catch (err2) {
      console.error("최종 오류:", err2);
      alert("전송 중 오류가 발생했습니다.\n잠시 후 다시 시도해 주세요.\n\n오류: " + err2.message);
    }
  } finally {
    sampleBtn.disabled         = false;
    sampleBtnText.textContent  = "샘플 즉시 받기";
    sampleLoader.style.display = "none";
  }
});

// ──────────────────────────────────────────────────────────
//  4. 토스페이먼츠 정기 빌링 인증 요청
// ──────────────────────────────────────────────────────────
const tossPayments = TossPayments(TOSS_CLIENT_KEY);

function requestBilling(emailInputId, planType, amount) {
  if (!currentUser) {
    alert("구독 결제는 로그인 후 이용 가능합니다.\n상단의 [Google 로그인] 버튼을 눌러주세요.");
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  const receiveEmailEl = document.getElementById(emailInputId);
  const receiveEmail   = receiveEmailEl?.value.trim();

  if (!receiveEmail || !isValidEmail(receiveEmail)) {
    alert("리포트를 받을 이메일 주소를 올바르게 입력해주세요.");
    receiveEmailEl?.focus();
    return;
  }

  // success.html 로 리다이렉트 시 필요한 파라미터 전달
  const successUrl = `${window.location.origin}/success.html` +
    `?receiveEmail=${encodeURIComponent(receiveEmail)}` +
    `&uid=${encodeURIComponent(currentUser.uid)}` +
    `&displayName=${encodeURIComponent(currentUser.displayName || "")}` +
    `&plan=${planType}` +
    `&amount=${amount}`;

  const failUrl = `${window.location.origin}/fail.html`;

  tossPayments.requestBillingAuth("카드", {
    customerKey: currentUser.uid,          // Firebase UID를 고객 키로 사용
    successUrl:  successUrl,
    failUrl:     failUrl,
  }).catch((err) => {
    if (err.code !== "USER_CANCEL") {
      console.error("토스페이먼츠 오류:", err);
      alert("결제 창을 여는 중 오류가 발생했습니다: " + err.message);
    }
  });
}

// 월간 구독 버튼
document.getElementById("subscribe-button")?.addEventListener("click", () => {
  requestBilling("checkout-email", "MONTHLY", 29800);
});

// 연간 구독 버튼
document.getElementById("subscribe-button-annual")?.addEventListener("click", () => {
  requestBilling("checkout-email-annual", "ANNUAL", 237600);
});
