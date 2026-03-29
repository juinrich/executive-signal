// api/dart-collector.js
// DART Open API -> Firestore 신호 수집기
// Vercel Cron: 평일 오전 8:00 KST (23:00 UTC) 실행
// vercel.json crons 설정:
//   { "path": "/api/dart-collector", "schedule": "0 23 * * 1-5" }

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// Firebase Admin 초기화
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

// DART Open API 설정
const DART_BASE = 'https://opendart.fss.or.kr/api';
const DART_KEY  = process.env.DART_API_KEY;

// 오늘 날짜를 YYYYMMDD 형식으로 반환 (KST)
function todayKST() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// N일 전 날짜를 YYYYMMDD 형식으로 반환
function daysAgo(n) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 - n * 86400 * 1000);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// DART 지분공시 목록 조회 (pblntf_ty=D: 임원/주요주주 소유상황 보고서)
async function fetchDartList(bgn_de, end_de) {
  const url = new URL(DART_BASE + '/list.json');
  url.searchParams.set('crtfc_key',  DART_KEY);
  url.searchParams.set('pblntf_ty',  'D');
  url.searchParams.set('bgn_de',     bgn_de);
  url.searchParams.set('end_de',     end_de);
  url.searchParams.set('page_count', '100');
  url.searchParams.set('sort',       'date');
  url.searchParams.set('sort_mth',   'desc');

  const res  = await fetch(url.toString());
  const data = await res.json();
  if (data.status !== '000') {
    console.warn('[DART] list.json 오류:', data.status, data.message);
    return [];
  }
  return data.list || [];
}

// DART 개별 보고서 상세 조회 (majorstock.json)
async function fetchReportDetail(rcpNo) {
  const url = new URL(DART_BASE + '/majorstock.json');
  url.searchParams.set('crtfc_key', DART_KEY);
  url.searchParams.set('rcpno',     rcpNo);

  const res  = await fetch(url.toString());
  const data = await res.json();
  if (data.status !== '000') return [];
  return data.list || [];
}

// 필터링 로직: 장내매수 + 5천만원 이상
const MIN_AMOUNT = 50000000;

function isValidSignal(row) {
  const method = (row.acqs_mth2 || row.acqs_mth || '').trim();
  const amount = parseKoreanNumber(row.acqs_amount || row.acqsAmount || '0');
  return method.includes('장내매수') && amount >= MIN_AMOUNT;
}

// 한국식 숫자 문자열 파서
function parseKoreanNumber(str) {
  if (!str) return 0;
  const cleaned = String(str).replace(/[,\s원]/g, '');
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

// Firestore 배치 저장 (컬렉션: dart_signals, 문서ID: rcpNo_rowIdx)
async function saveSignals(db, signals) {
  if (signals.length === 0) return 0;
  const batch = db.batch();
  for (const sig of signals) {
    const ref = db.collection('dart_signals').doc(sig.rcpNo + '_' + sig.rowIdx);
    batch.set(ref, sig, { merge: true });
  }
  await batch.commit();
  return signals.length;
}

// 신호 객체 생성
function buildSignal(filing, row, rowIdx) {
  return {
    rcpNo:        filing.rcept_no,
    corpName:     filing.corp_name,
    corpCode:     filing.corp_code,
    stockCode:    filing.stock_code || '',
    reportNm:     filing.report_nm,
    filedAt:      filing.rcept_dt,
    dartUrl:      'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + filing.rcept_no,
    reporterName: row.repror_nm    || '',
    reporterRole: row.repror_role  || '',
    stockType:    row.stkqy_tp_nm  || '',
    acqsMethod:   row.acqs_mth2    || row.acqs_mth || '',
    acqsShares:   parseKoreanNumber(row.trmend_qy    || '0'),
    acqsAmount:   parseKoreanNumber(row.acqs_amount  || '0'),
    acqsPrice:    parseKoreanNumber(row.acqs_pp      || '0'),
    beforeShares: parseKoreanNumber(row.bftr_posesn_stock_qy  || '0'),
    afterShares:  parseKoreanNumber(row.atftr_posesn_stock_qy || '0'),
    afterRatio:   row.atftr_posesn_stock_rt || '',
    rowIdx,
    savedAt: Timestamp.now(),
  };
}

// Vercel 서버리스 핸들러
export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!DART_KEY) {
    return res.status(500).json({ error: 'DART_API_KEY 환경변수가 설정되지 않았습니다.' });
  }

  try {
    initFirebase();
    const db = getFirestore();

    const end_de = todayKST();
    const bgn_de = daysAgo(3);

    console.log('[DART] 공시 목록 조회:', bgn_de, '~', end_de);
    const filings = await fetchDartList(bgn_de, end_de);
    console.log('[DART] 공시', filings.length, '건 발견');

    const signals = [];
    let processed = 0;

    for (const filing of filings) {
      if (!filing.stock_code) continue;
      try {
        const rows = await fetchReportDetail(filing.rcept_no);
        for (let i = 0; i < rows.length; i++) {
          if (isValidSignal(rows[i])) {
            signals.push(buildSignal(filing, rows[i], i));
          }
        }
        processed++;
        await new Promise(r => setTimeout(r, 100));
      } catch (e) {
        console.warn('[DART]', filing.rcept_no, '상세 조회 실패:', e.message);
      }
    }

    const saved = await saveSignals(db, signals);

    console.log('[DART] 처리:', processed, '건 / 신호:', signals.length, '건 저장');
    return res.status(200).json({
      ok:        true,
      period:    bgn_de + '~' + end_de,
      filings:   filings.length,
      processed,
      signals:   signals.length,
      saved,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[DART] 수집 오류:', err);
    return res.status(500).json({ error: err.message });
  }
}
