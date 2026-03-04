#!/usr/bin/env bash
# ================================================================
#  Executive Signal — 자동 배포 스크립트
#  이 파일을 터미널에서 실행하거나, 섹션별로 복붙하세요.
#  사전 준비: Node.js 설치 (https://nodejs.org)
# ================================================================

set -e

N8N_API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxNzAxODkzZC0yZDVhLTQxNjktYmQ3My00ZjEzOWNkNzhkY2MiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzY4OTA3NDg0fQ.lpYfYb0s_oPb85gNPsnbMttuDEocJe7SMRdCD9liSVE"
N8N_BASE="https://munjuin.app.n8n.cloud/api/v1"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  STEP 1 — n8n 워크플로우 자동 등록"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1-A. 결제 처리기 워크플로우 등록
echo "[1/2] 결제 처리기 워크플로우 등록 중..."
PAYMENT_RESULT=$(curl -s -X POST "$N8N_BASE/workflows" \
  -H "Authorization: Bearer $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d @n8n_payment_processor.json)
PAYMENT_ID=$(echo "$PAYMENT_RESULT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  ✅ 결제 처리기 등록 완료 (ID: $PAYMENT_ID)"

# 1-B. 결제 처리기 활성화
curl -s -X PATCH "$N8N_BASE/workflows/$PAYMENT_ID" \
  -H "Authorization: Bearer $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"active": true}' > /dev/null
echo "  ✅ 결제 처리기 활성화 완료"

# 1-C. 샘플 발송기 워크플로우 등록
echo "[2/2] 샘플 발송기 워크플로우 등록 중..."
SAMPLE_RESULT=$(curl -s -X POST "$N8N_BASE/workflows" \
  -H "Authorization: Bearer $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d @n8n_sample_sender.json)
SAMPLE_ID=$(echo "$SAMPLE_RESULT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  ✅ 샘플 발송기 등록 완료 (ID: $SAMPLE_ID)"

# 1-D. 샘플 발송기 활성화
curl -s -X PATCH "$N8N_BASE/workflows/$SAMPLE_ID" \
  -H "Authorization: Bearer $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"active": true}' > /dev/null
echo "  ✅ 샘플 발송기 활성화 완료"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  STEP 2 — Firebase 설정값 입력"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "아래 주소에서 Firebase 설정값을 가져오세요:"
echo "  https://console.firebase.google.com"
echo "  → 프로젝트 추가 → 프로젝트 설정 → 내 앱 → 웹 앱 추가"
echo ""
read -p "  apiKey: "            FB_API_KEY
read -p "  authDomain: "        FB_AUTH_DOMAIN
read -p "  projectId: "         FB_PROJECT_ID
read -p "  storageBucket: "     FB_STORAGE_BUCKET
read -p "  messagingSenderId: " FB_SENDER_ID
read -p "  appId: "             FB_APP_ID

# script.js 의 Firebase 설정값 자동 치환
sed -i.bak \
  -e "s|YOUR_API_KEY|$FB_API_KEY|g" \
  -e "s|YOUR_PROJECT_ID.firebaseapp.com|$FB_AUTH_DOMAIN|g" \
  -e "s|YOUR_PROJECT_ID.appspot.com|$FB_STORAGE_BUCKET|g" \
  -e "s|YOUR_PROJECT_ID|$FB_PROJECT_ID|g" \
  -e "s|YOUR_SENDER_ID|$FB_SENDER_ID|g" \
  -e "s|YOUR_APP_ID|$FB_APP_ID|g" \
  script.js
rm -f script.js.bak
echo "  ✅ script.js Firebase 설정값 입력 완료"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  STEP 3 — Vercel 배포"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Vercel CLI 설치 (없는 경우)
if ! command -v vercel &> /dev/null; then
  echo "[설치] Vercel CLI 설치 중..."
  npm install -g vercel
fi

echo ""
echo "  Vercel 로그인 & 배포를 시작합니다."
echo "  (최초 실행 시 브라우저 로그인 창이 열립니다)"
echo ""
vercel --prod

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🎉 배포 완료!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  마지막으로 Firebase Console 에서:"
echo "  Authentication → Settings → 승인된 도메인"
echo "  → 위에서 출력된 Vercel 도메인을 추가해 주세요."
echo ""
