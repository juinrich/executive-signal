# ================================================================
#  Executive Signal — Windows 배포 스크립트 (PowerShell)
#  PowerShell 창에서 실행: .\deploy.ps1
# ================================================================

$N8N_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxNzAxODkzZC0yZDVhLTQxNjktYmQ3My00ZjEzOWNkNzhkY2MiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzY4OTA3NDg0fQ.lpYfYb0s_oPb85gNPsnbMttuDEocJe7SMRdCD9liSVE"
$N8N_BASE = "https://munjuin.app.n8n.cloud/api/v1"
$HEADERS  = @{ "Authorization" = "Bearer $N8N_API_KEY"; "Content-Type" = "application/json" }

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  STEP 1 — n8n 워크플로우 자동 등록" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

# 1-A. 결제 처리기 등록
Write-Host "[1/2] 결제 처리기 등록 중..." -ForegroundColor Yellow
$paymentBody = Get-Content "n8n_payment_processor.json" -Raw
$paymentResp = Invoke-RestMethod -Uri "$N8N_BASE/workflows" -Method POST -Headers $HEADERS -Body $paymentBody
$paymentId   = $paymentResp.id
Write-Host "  ✅ 완료 (ID: $paymentId)" -ForegroundColor Green

# 활성화
Invoke-RestMethod -Uri "$N8N_BASE/workflows/$paymentId" -Method PATCH -Headers $HEADERS `
  -Body '{"active": true}' | Out-Null
Write-Host "  ✅ 활성화 완료" -ForegroundColor Green

# 1-B. 샘플 발송기 등록
Write-Host "[2/2] 샘플 발송기 등록 중..." -ForegroundColor Yellow
$sampleBody = Get-Content "n8n_sample_sender.json" -Raw
$sampleResp = Invoke-RestMethod -Uri "$N8N_BASE/workflows" -Method POST -Headers $HEADERS -Body $sampleBody
$sampleId   = $sampleResp.id
Write-Host "  ✅ 완료 (ID: $sampleId)" -ForegroundColor Green

Invoke-RestMethod -Uri "$N8N_BASE/workflows/$sampleId" -Method PATCH -Headers $HEADERS `
  -Body '{"active": true}' | Out-Null
Write-Host "  ✅ 활성화 완료" -ForegroundColor Green

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  STEP 2 — Firebase 설정값 입력" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "  https://console.firebase.google.com 에서 값을 복사하세요" -ForegroundColor Gray

$FB_API_KEY    = Read-Host "  apiKey"
$FB_AUTH       = Read-Host "  authDomain"
$FB_PROJECT    = Read-Host "  projectId"
$FB_STORAGE    = Read-Host "  storageBucket"
$FB_SENDER     = Read-Host "  messagingSenderId"
$FB_APP        = Read-Host "  appId"

# script.js 치환
$script = Get-Content "script.js" -Raw
$script = $script -replace "YOUR_API_KEY",            $FB_API_KEY
$script = $script -replace "YOUR_PROJECT_ID\.firebaseapp\.com", $FB_AUTH
$script = $script -replace "YOUR_PROJECT_ID\.appspot\.com",     $FB_STORAGE
$script = $script -replace "YOUR_PROJECT_ID",          $FB_PROJECT
$script = $script -replace "YOUR_SENDER_ID",           $FB_SENDER
$script = $script -replace "YOUR_APP_ID",              $FB_APP
$script | Set-Content "script.js" -Encoding UTF8
Write-Host "  ✅ script.js 업데이트 완료" -ForegroundColor Green

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  STEP 3 — Vercel 배포" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

# Vercel CLI 설치 확인
if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
    Write-Host "  Vercel CLI 설치 중..." -ForegroundColor Yellow
    npm install -g vercel
}

Write-Host ""
Write-Host "  배포를 시작합니다. 브라우저 로그인 창이 열립니다." -ForegroundColor Yellow
vercel --prod

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  🎉 배포 완료!" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "  마지막으로 Firebase Console 에서:" -ForegroundColor Gray
Write-Host "  Authentication → 승인된 도메인 → Vercel 도메인 추가" -ForegroundColor Gray
