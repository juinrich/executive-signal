// api/dart-sender.js
// n8n "Executive Signal - Daily Broadcast to All Subscribers" 워크플로우 이식
// Firestore dart_signals + subscribers → Gmail 발송
// Cron: vercel.json "32 23 * * 1-5" (평일 KST 08:32, dart-collector 32분 후)

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';

// ── Firebase Admin 초기화 ────────────────────────────────────────────────────
function initFirebase() {
  if (getApps().length > 0) return;
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

// ── Gmail Transporter ────────────────────────────────────────────────────────
function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

// ── 날짜 문자열 (KST) ────────────────────────────────────────────────────────
function getKstDateStr() {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const now = new Date(Date.now() + 9 * 3600_000);
  const dateStr  = `${now.getUTCFullYear()}년 ${now.getUTCMonth() + 1}월 ${now.getUTCDate()}일(${days[now.getUTCDay()]})`;
  const shortDate = `${now.getUTCMonth() + 1}/${now.getUTCDate()}(${days[now.getUTCDay()]})`;
  return { dateStr, shortDate };
}

// ── 1. Firestore에서 오늘 dart_signals 조회 ─────────────────────────────────
async function getTodaySignals(db) {
  const now = new Date(Date.now() + 9 * 3600_000);
  const today = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;

  const snap = await db.collection('dart_signals')
    .where('filedAt', '>=', today)
    .orderBy('filedAt', 'desc')
    .orderBy('매수금액(원)', 'desc')
    .limit(50)
    .get();

  return snap.docs.map(d => d.data());
}

// ── 2. Firestore에서 ACTIVE 구독자 조회 ─────────────────────────────────────
async function getActiveSubscribers(db) {
  const snap = await db.collection('subscribers')
    .where('상태', '==', 'ACTIVE')
    .get();

  return snap.docs
    .map(d => d.data())
    .filter(s => s['이메일'] && s['이메일'].includes('@'));
}

// ── 3. 프리미엄 이메일 HTML 빌드 ────────────────────────────────────────────
function buildPremiumEmail(subscriber, dartData, shortDate, dateStr) {
  const { '이메일': email, '이름': name = '', '구독키': subscribeKey = '' } = subscriber;

  const sortedData = [...dartData]
    .sort((a, b) => Number(b['매수금액(원)'] || 0) - Number(a['매수금액(원)'] || 0))
    .slice(0, 10);

  const siteUrl = process.env.SITE_URL || 'https://executive-signal-seven.vercel.app';
  const unsubUrl = `${siteUrl}/api/unsubscribe?key=${encodeURIComponent(subscribeKey)}&email=${encodeURIComponent(email)}`;
  const totalSum = sortedData.reduce((acc, d) => acc + Number(d['매수금액(원)'] || 0), 0);
  const greeting = name ? `${name}님,` : '안녕하세요,';

  let rows = '';
  if (sortedData.length === 0) {
    rows = `<tr><td colspan="7" style="padding:24px;text-align:center;color:#666;font-size:13px;">오늘은 5천만원 이상 임원 매수 공시가 없습니다.</td></tr>`;
  } else {
    sortedData.forEach((d, i) => {
      const corpName = d['기업명'] || '-';
      const execName = d['임원명'] || '-';
      const reason   = d['변동사유'] || '-';
      const note     = d['비고'] || '-';
      const rceptNo  = d['rcept_no'] || '';
      const totalAmt = Number(d['매수금액(원)'] || 0);
      const qty      = Number(d['trade_qty'] || 0);
      const price    = Number(d['unit_price'] || 0);
      const level    = d['임원등급'] || '';

      const qtyStr   = qty   > 0 ? `${qty.toLocaleString('ko-KR')}주`   : '-';
      const priceStr = price > 0 ? `${price.toLocaleString('ko-KR')}원` : '-';
      const totalStr = totalAmt > 0
        ? `<strong style="color:#D4AF37">${totalAmt.toLocaleString('ko-KR')}원</strong>`
        : '<span style="color:#555">확인불가</span>';
      const levelBadge = level === 'High'
        ? `<span style="background:#D4AF37;color:#000;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700;">HIGH</span>`
        : '';
      const bg   = i % 2 === 0 ? '#1a1f28' : '#161B22';
      const link = rceptNo ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rceptNo}` : '#';

      rows += `<tr style="background:${bg};border-bottom:1px solid #2a2f3a;">
        <td style="padding:11px 12px;"><a href="${link}" style="color:#D4AF37;text-decoration:none;font-weight:600;">${corpName}</a></td>
        <td style="padding:11px 12px;color:#ccc;">${execName} ${levelBadge}</td>
        <td style="padding:11px 12px;text-align:right;color:#ccc;">${qtyStr}</td>
        <td style="padding:11px 12px;text-align:right;color:#ccc;">${priceStr}</td>
        <td style="padding:11px 12px;text-align:right;">${totalStr}</td>
        <td style="padding:11px 12px;text-align:center;color:#888;font-size:12px;">${reason}</td>
        <td style="padding:11px 12px;text-align:center;color:#666;font-size:12px;">${note}</td>
      </tr>`;
    });
  }

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0A0C10;">
<div style="max-width:720px;margin:0 auto;padding:32px 16px;font-family:Arial,sans-serif;color:#fff;">
  <div style="margin-bottom:24px;">
    <span style="font-size:1.3rem;font-weight:800;">Executive</span><span style="color:#D4AF37;font-size:1.3rem;font-weight:800;">Signal</span>
    <span style="display:inline-block;background:linear-gradient(135deg,#D4AF37,#B38F2D);color:#000;font-size:0.7rem;font-weight:800;padding:3px 10px;border-radius:20px;margin-left:10px;">PREMIUM</span>
  </div>
  <div style="background:linear-gradient(135deg,#1a1506,#2a2208);border:1px solid rgba(212,175,55,0.3);border-radius:12px;padding:20px 24px;margin-bottom:20px;">
    <h2 style="margin:0 0 6px;font-size:1.2rem;">${dateStr} 임원 매수 신호 리포트</h2>
    <p style="margin:0;color:#8B949E;font-size:0.85rem;">${greeting} 총 <strong style="color:#D4AF37">${sortedData.length}건</strong> | 합계 <strong style="color:#D4AF37">${totalSum.toLocaleString('ko-KR')}원</strong></p>
  </div>
  <div style="border-radius:12px;overflow:hidden;border:1px solid #2a2f3a;margin-bottom:20px;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:#1e2430;">
        <th style="padding:11px 12px;text-align:left;color:#D4AF37;font-size:11px;">기업명</th>
        <th style="padding:11px 12px;text-align:left;color:#D4AF37;font-size:11px;">임원명</th>
        <th style="padding:11px 12px;text-align:right;color:#D4AF37;font-size:11px;">수량(주)</th>
        <th style="padding:11px 12px;text-align:right;color:#D4AF37;font-size:11px;">단가(원)</th>
        <th style="padding:11px 12px;text-align:right;color:#D4AF37;font-size:11px;">총 매수금액</th>
        <th style="padding:11px 12px;text-align:center;color:#D4AF37;font-size:11px;">변동사유</th>
        <th style="padding:11px 12px;text-align:center;color:#D4AF37;font-size:11px;">비고</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <p style="color:#333;font-size:0.75rem;line-height:1.6;border-top:1px solid #1e1e1e;padding-top:16px;">
    본 리포트는 금융감독원 DART 공시 데이터를 기반으로 합니다. 모든 투자 판단의 책임은 본인에게 있습니다.<br>
    <a href="${unsubUrl}" style="color:#555;">수신 거부</a> | © 2026 Executive Signal
  </p>
</div></body></html>`;

  return { email, subject: `[프리미엄] ${shortDate} 임원 매수 신호 리포트 — Executive Signal`, body: html };
}

// ── 메인 핸들러 ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const auth = req.headers['authorization'];
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return res.status(500).json({ error: 'Gmail 환경변수 없음 (GMAIL_USER, GMAIL_APP_PASSWORD)' });
  }

  try {
    initFirebase();
    const db = getFirestore();
    const { shortDate, dateStr } = getKstDateStr();
    const [dartData, subscribers] = await Promise.all([
      getTodaySignals(db),
      getActiveSubscribers(db),
    ]);

    console.log(`[SENDER] dart_signals: ${dartData.length}건, 구독자: ${subscribers.length}명`);

    if (subscribers.length === 0) {
      return res.status(200).json({ ok: true, message: '활성 구독자 없음', sent: 0 });
    }

    const transporter = createTransporter();
    let sent = 0;
    const errors = [];

    for (const sub of subscribers) {
      try {
        const { email, subject, body } = buildPremiumEmail(sub, dartData, shortDate, dateStr);
        await transporter.sendMail({
          from: `"Executive Signal" <${process.env.GMAIL_USER}>`,
          to: email, subject, html: body,
        });
        sent++;
        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        console.error(`[SENDER] 발송 실패 (${sub['이메일']}):`, e.message);
        errors.push({ email: sub['이메일'], error: e.message });
      }
    }

    return res.status(200).json({
      ok: true, date: dateStr, dartSignals: dartData.length,
      subscribers: subscribers.length, sent,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[SENDER] 오류:', err);
    return res.status(500).json({ error: err.message });
  }
}
