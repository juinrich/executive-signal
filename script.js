// ============================================================
// Executive Signal — script.js
// Firebase Google Auth (GIS 방식) + 토스페이먼츠 빌링 + n8n Webhook 연동
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth, signInWithCredential, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCq2Tzk2-hhXDBu8bu-uxNozJPZ4NrtoSw",
  authDomain: "insider-66472.firebaseapp.com",
  projectId: "insider-66472",
  storageBucket: "insider-66472.firebasestorage.app",
  messagingSenderId: "729919164559",
  appId: "1:729919164559:web:5263bd8c9d93e73249e0fa"
};

const TOSS_CLIENT_KEY = "test_ck_D5b9pwE1jn4R6o96A593RG9O5Xma";
const N8N_SAMPLE_WEBHOOK_URL = "https://munjuin.app.n8n.cloud/webhook/sample-request";
const N8N_PAYMENT_WEBHOOK_URL = "https://munjuin.app.n8n.cloud/webhook/payment-success";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const loginBtn = document.getElementById("auth-login-btn");
const logoutBtn = document.getElementById("auth-logout-btn");
const userInfo = document.getElementById("auth-user-info");
const userAvatar = document.getElementById("auth-user-avatar");
const userName = document.getElementById("auth-user-name");
let currentUser = null;

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    loginBtn.style.display = "none";
    userInfo.style.display = "flex";
    userAvatar.src = user.photoURL || "";
    userName.textContent = user.displayName || user.email;
    ["checkout-email", "checkout-email-annual"].forEach((id) => {
      const el = document.getElementById(id);
      if (el && !el.value) el.value = user.email;
    });
  } else {
    loginBtn.style.display = "inline-flex";
    userInfo.style.display = "none";
  }
});

// ── Google 로그인: GIS(Google Identity Services) 방식 ──
// signInWithPopup 대신 GIS 토큰 방식 사용 → Firebase 팝업 핸들러 오류 완전 해결
loginBtn?.addEventListener("click", () => {
  if (typeof google === 'undefined' || !google.accounts) {
    alert("Google 로그인을 초기화하는 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }
  const tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: '729919164559-259m9uhs1vv8qv4939ko8gu4d4behu4i.apps.googleusercontent.com',
    scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid',
    prompt: 'select_account',
    callback: async (tokenResponse) => {
      if (tokenResponse && tokenResponse.access_token) {
        const credential = GoogleAuthProvider.credential(null, tokenResponse.access_token);
        signInWithCredential(auth, credential).catch(e => {
          console.error('signIn error:', e);
          alert("로그인에 실패했습니다: " + e.message);
        });
      }
    }
  });
  tokenClient.requestAccessToken();
});

logoutBtn?.addEventListener("click", () => {
  signOut(auth).catch(console.error);
});

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function showPopup(msg) {
  const popup = document.getElementById("sample-popup");
  if (!popup) return;
  if (msg) popup.textContent = msg;
  popup.classList.add("show");
  setTimeout(() => popup.classList.remove("show"), 3500);
}

const sampleBtn = document.getElementById("sample-button");
const sampleEmailEl = document.getElementById("sample-email");
const sampleBtnText = document.getElementById("sample-btn-text");
const sampleLoader = document.getElementById("sample-loader");

sampleBtn?.addEventListener("click", async () => {
  const email = sampleEmailEl?.value.trim();
  if (!email || !isValidEmail(email)) {
    alert("유효한 이메일 주소를 입력해주세요.");
    sampleEmailEl?.focus();
    return;
  }
  sampleBtn.disabled = true;
  sampleBtnText.textContent = "전송 중...";
  sampleLoader.style.display = "inline-block";
  try {
    const resp = await fetch(N8N_SAMPLE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, type: "FREE_SAMPLE", timestamp: new Date().toISOString() })
    });
    if (!resp.ok) throw new Error("서버 오류: " + resp.status);
    showPopup("✅ 메일함으로 샘플이 발송되었습니다!");
    sampleEmailEl.value = "";
  } catch (err) {
    try {
      await fetch(N8N_SAMPLE_WEBHOOK_URL, {
        method: "POST", mode: "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ email, type: "FREE_SAMPLE", timestamp: new Date().toISOString() })
      });
      showPopup("✅ 메일함으로 샘플이 발송되었습니다!");
      sampleEmailEl.value = "";
    } catch (err2) {
      alert("전송 중 오류가 발생했습니다.\n" + err2.message);
    }
  } finally {
    sampleBtn.disabled = false;
    sampleBtnText.textContent = "샘플 즉시 받기";
    sampleLoader.style.display = "none";
  }
});

const tossPayments = TossPayments(TOSS_CLIENT_KEY);
function requestBilling(emailInputId, planType, amount) {
  if (!currentUser) {
    alert("구독 결제는 로그인 후 이용 가능합니다.\n상단의 [Google 로그인] 버튼을 눌러주세요.");
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const receiveEmailEl = document.getElementById(emailInputId);
  const receiveEmail = receiveEmailEl?.value.trim();
  if (!receiveEmail || !isValidEmail(receiveEmail)) {
    alert("리포트를 받을 이메일 주소를 올바르게 입력해주세요.");
    receiveEmailEl?.focus();
    return;
  }
  const successUrl = window.location.origin + "/success.html"
    + "?receiveEmail=" + encodeURIComponent(receiveEmail)
    + "&uid=" + encodeURIComponent(currentUser.uid)
    + "&displayName=" + encodeURIComponent(currentUser.displayName || "")
    + "&plan=" + planType
    + "&amount=" + amount;
  const failUrl = window.location.origin + "/fail.html";
  tossPayments.requestBillingAuth("카드", {
    customerKey: currentUser.uid,
    successUrl,
    failUrl,
  }).catch((err) => {
    if (err.code !== "USER_CANCEL") {
      alert("결제 창을 여는 중 오류가 발생했습니다: " + err.message);
    }
  });
}

document.getElementById("subscribe-button")?.addEventListener("click", () => {
  requestBilling("checkout-email", "MONTHLY", 29800);
});
document.getElementById("subscribe-button-annual")?.addEventListener("click", () => {
  requestBilling("checkout-email-annual", "ANNUAL", 237600);
});
