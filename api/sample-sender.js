// api/sample-sender.js
// n8n "Executive Signal - Sample Sender v7" 워크플로우 이식
// POST { email } → Firestore dart_signals 최신 5건 → 샘플 이메일 발송

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';

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

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

async function getLatestSignals(db) {
  const snap = await db.collection('dart_signals')
    .orderBy('savedAt', 'desc')
    .limit(5)
    .get();
  return snap.docs.map(d => d.data());
}

function buildSampleEmail(email, items) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const now  = new Date(Date.now() + 9 * 3600_000);
  const shortDate = `${now.getUTCMonth() + 1}/${now.getUTCDate()}(${days[now.getUTCDay()]})`;
  const siteUrl = process.env.SITE_URL || 'https://executive-signal-seven.vercel.app';

  let rows = '';
  if (items.length === 0) {
    rows = `<tr><td colspan="7" style="padding:24px;text-align:center;color:#666;font-size:13px;">오늘은 분석된 데이터가 없습니다.<br>내일 아침 8시 업데이트 후 다시 확인해 주세요.</td></tr>`;
  } else {
    items.forEach((d, i) => {
      const corpName = d['기업명'] || '-';
      const execName = d['임원명'] || '-';
      const reason   = d['변동사유'] || '-';
      const note     = d['비고'] || '-';
      const rceptNo  = d['rcept_no'] || '';
      const totalAmt = Number(d['매수금액(원)'] || 0);
      const qty      = Number(d['trade_qty'] || 0);
      const price    = Number(d['unit_price'] || 0);
      const qtyStr   = qty   > 0 ? `${qty.toLocaleString('ko-KR')}주`   : '-';
      const priceStr = price > 0 ? `${price.toLocaleString('ko-KR')}원` : '-';
      const totalStr = totalAmt > 0
        ? `<strong style="color:#D4AF37">${totalAmt.toLocaleString('ko-KR')}원</strong>`
        : '<span style="color:#555">확인불가</span>';
      const bg   = i % 2 === 0 ? '#1a1f28' : '#161B22';
      const link = rceptNo ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rceptNo}` : '#';
      rows += `<tr style="background:${bg};border-bottom:1px solid #2a2f3a;">
        <td style="padding:11px 12px;"><a href="${link}" style="color:#D4AF37;text-decoration:none;font-weight:600;">${corpName}</a></td>
        <td style="padding:11px 12px;color:#ccc;">${execName}</td>
        <td style="padding:11px 12px;text-align:right;color:#ccc;">${qtyStr}</td>
        <td style="padding:11px 12px;text-align:right;color:#ccc;">${priceStr}</td>
        <td style="padding:11px 12px;text-align:right;">${totalStr}</td>
        <td style="padding:11px 12px;text-align:center;color:#888;font-size:12px;">${reason}</td>
        <td style="padding:11px 12px;text-align:center;color:#666;font-size:12px;">${note}</td>
      </tr>`;
    });
  }

  const html = `<!DOCTYPE html><html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0A0C10;">
<div style="max-width:720px;margin:0 auto;padding:32px 16px;font-family:Arial,sans-serif;color:#fff;">
  <div style="margin-bottom:24px;">
    <span style="font-size:1.3rem;font-weight:800;">Executive</span><span style="color:#D4AF37;font-size:1.3rem;font-weight:800;">Signal</span>
    <span style="display:inline-block;background:linear-gradient(135deg,#D4AF37,#B38F2D);color:#000;font-size:0.7rem;font-weight:800;padding:3px 10px;border-radius:20px;margin-left:10px;">FREE SAMPLE</span>
  </div>
  <div style="background:linear-gradient(135deg,#1a1506,#2a2208);border:1px solid rgba(212,175,55,0.3);border-radius:12px;padding:20px 24px;margin-bottom:20px;">
    <h2 style="margin:0 0 6px;font-size:1.2rem;">[샘플] ${shortDate} 임원 매수 신호 리포트</h2>
    <p style="margin:0;color:#8B949E;font-size:0.85rem;">최근 포착된 임원 매수 시그널 상위 5건</p>
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
    <div style="background:#161B22;border-top:1px solid #2a2f3a;padding:14px;text-align:center;font-size:0.85rem;color:#8B949E;">
      🔒 구독자에게는 <strong style="color:#D4AF37;">전체 데이터가 매일 발송</strong>됩니다
    </div>
  </div>
  <div style="background:#161B22;border:1px solid rgba(212,175,55,0.25);border-radius:16px;padding:28px 24px;text-align:center;margin-bottom:20px;">
    <h3 style="margin:0 0 8px;font-size:1.2rem;">매일 아침 8시, 놓치는 시그널이 없도록</h3>
    <p style="color:#8B949E;margin:0 0 20px;font-size:0.9rem;line-height:1.7;">구독하면 모든 임원 매수 시그널을 매일 받아볼 수 있습니다.</p>
    <div style="margin-bottom:16px;">
      <span style="text-decoration:line-through;color:#555;font-size:0.9rem;">₩49,000</span>
      <div style="font-size:2rem;font-weight:800;color:#D4AF37;">₩29,800<span style="font-size:1rem;color:#8B949E;">/월</span></div>
    </div>
    <a href="${siteUrl}/#pricing" style="display:inline-block;background:linear-gradient(135deg,#D4AF37,#B38F2D);color:#000;font-weight:700;padding:14px 40px;border-radius:8px;text-decoration:none;font-size:1rem;">지금 구독 시작하기 →</a>
  </div>
  <p style="color:#333;font-size:0.75rem;line-height:1.6;border-top:1px solid #1e1e1e;padding-top:16px;">
    본 리포트는 금융감독원 DART 공시 데이터를 기반으로 합니다. 모든 투자 판단의 책임은 본인에게 있습니다.<br>
    © 2026 Executive Signal
  </p>
</div></body></html>`;

  return { email, subject: `[무료 샘플] ${shortDate} 임원 매수 신호 리포트 — Executive Signal`, body: html };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  const body  = req.body || {};
  const email = (body.email || body.receiveEmail || req.query?.email || '').trim();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, error: '유효한 이메일이 필요합니다.' });
  }
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return res.status(500).json({ success: false, error: 'Gmail 환경변수 없음' });
  }

  try {
    initFirebase();
    const db = getFirestore();
    const signals = await getLatestSignals(db);
    console.log(`[SAMPLE] 이메일: ${email}, 데이터: ${signals.length}건`);

    const { subject, body: html } = buildSampleEmail(email, signals);
    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"Executive Signal" <${process.env.GMAIL_USER}>`,
      to: email, subject, html,
    });

    console.log(`[SAMPLE] 발송 완료 → ${email}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[SAMPLE] 오류:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
