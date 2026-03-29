// api/unsubscribe.js
// n8n "Executive Signal - Unsubscribe Handler" 워크플로우 이식
// GET /api/unsubscribe?key=<구독키>&email=<이메일> → Firestore 상태 UNSUBSCRIBED 업데이트

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

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

const UNSUBSCRIBE_HTML = `<!DOCTYPE html>
<html lang='ko'>
<head>
  <meta charset='UTF-8'>
  <meta name='viewport' content='width=device-width,initial-scale=1'>
  <title>수신 거부 완료 — Executive Signal</title>
  <style>
    body { background:#0A0C10; color:#fff; font-family:'Apple SD Gothic Neo',Arial,sans-serif;
           display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
    .card { background:#161B22; border-radius:24px; padding:3rem; max-width:420px; text-align:center; border:1px solid #2a2f3a; }
    h1 { font-size:1.5rem; margin:12px 0 8px; }
    p  { color:#8B949E; line-height:1.7; }
    a  { color:#D4AF37; text-decoration:none; }
  </style>
</head>
<body>
  <div class='card'>
    <div style='font-size:3rem'>✅</div>
    <h1>수신 거부 완료</h1>
    <p>더 이상 Executive Signal 리포트가 발송되지 않습니다.</p>
    <p style='margin-top:1.5rem;font-size:0.85rem;'>
      다시 구독을 원하시면<br>
      <a href='https://executive-signal-seven.vercel.app/#pricing'>여기서 재구독</a>하실 수 있습니다.
    </p>
  </div>
</body>
</html>`;

const errorHtml = (msg) => `<!DOCTYPE html>
<html lang='ko'>
<head>
  <meta charset='UTF-8'>
  <title>오류 — Executive Signal</title>
  <style>
    body { background:#0A0C10; color:#fff; font-family:Arial;
           display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
    .card { background:#161B22; border-radius:24px; padding:3rem; max-width:420px; text-align:center; border:1px solid #2a2f3a; }
  </style>
</head>
<body>
  <div class='card'>
    <div style='font-size:3rem'>⚠️</div>
    <h1 style='font-size:1.2rem;margin:12px 0;'>처리 중 오류가 발생했습니다</h1>
    <p style='color:#8B949E;font-size:0.85rem;'>${msg}</p>
  </div>
</body>
</html>`;

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const query = req.query || {};
  const email = decodeURIComponent(query.email || '').trim();
  const key   = decodeURIComponent(query.key   || '').trim();

  if (!email || !email.includes('@')) {
    return res.status(400).send(errorHtml('유효하지 않은 이메일 주소입니다.'));
  }

  try {
    initFirebase();
    const db = getFirestore();

    const snap = await db.collection('subscribers')
      .where('이메일', '==', email)
      .limit(1)
      .get();

    if (snap.empty) {
      console.log(`[UNSUB] 구독자 없음: ${email}`);
      return res.status(200).send(UNSUBSCRIBE_HTML);
    }

    const docRef = snap.docs[0].ref;
    const data   = snap.docs[0].data();

    if (key && data['구독키'] && data['구독키'] !== key) {
      console.warn(`[UNSUB] 구독키 불일치: ${email}`);
      return res.status(403).send(errorHtml('유효하지 않은 수신 거부 링크입니다.'));
    }

    await docRef.update({
      '상태':           'UNSUBSCRIBED',
      'unsubscribedAt': Timestamp.now(),
    });

    console.log(`[UNSUB] 수신 거부 완료: ${email}`);
    return res.status(200).send(UNSUBSCRIBE_HTML);

  } catch (err) {
    console.error('[UNSUB] 오류:', err);
    return res.status(500).send(errorHtml('서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'));
  }
}
