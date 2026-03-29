// api/dart-collector.js
// n8n "임원매수리포트260302" 워크플로우를 Vercel 서버리스로 이식
// 핵심 방식: list.json → document.xml(ZIP) → XML 직접 파싱 → (+) 필터 → Firestore 저장
// Cron: vercel.json "0 23 * * 1-5" (평일 KST 08:00)

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// ── Firebase Admin 초기화 ─────────────────────────────────────────────────
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

const DART_KEY  = process.env.DART_API_KEY;
const DART_BASE = 'https://opendart.fss.or.kr/api';

// ── 날짜 범위 (n8n Date_Range_Generator 동일 로직) ────────────────────────
function getDateRange() {
  const now = new Date(Date.now() + 9 * 3600000); // KST
  const fmt = (d) => {
    const y  = d.getUTCFullYear();
    const m  = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return y + m + dd;
  };
  const end_de  = fmt(now);
  const daysBack = now.getUTCDay() === 1 ? 3 : 1; // 월요일이면 3일 전(금요일)
  const from    = new Date(now.getTime() - daysBack * 86400000);
  return { bgn_de: fmt(from), end_de };
}

// ── 1. DART 공시 목록 (list.json) ─────────────────────────────────────────
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
  if (data.status !== '000') { console.warn('[DART] list 오류:', data.message); return []; }
  return (data.list || []).filter(f => f.stock_code); // 상장 종목만
}

// ── 2. 공시 원문 ZIP 다운로드 (document.xml) ─────────────────────────────
async function downloadZip(rcptNo) {
  const url = DART_BASE + '/document.xml?crtfc_key=' + DART_KEY + '&rcept_no=' + rcptNo;
  const res = await fetch(url);
  if (!res.ok) throw new Error('document.xml HTTP ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

// ── 3. ZIP → XML 추출 (외부 의존성 없음) ─────────────────────────────────
function extractXmlFromZip(zipBuf) {
  const chunks = [];
  let i = 0;
  while (i < zipBuf.length - 4) {
    // Local file header signature PK\x03\x04
    if (zipBuf[i]===0x50 && zipBuf[i+1]===0x4B && zipBuf[i+2]===0x03 && zipBuf[i+3]===0x04) {
      const compression = zipBuf.readUInt16LE(i + 8);
      const compSize    = zipBuf.readUInt32LE(i + 18);
      const fnLen       = zipBuf.readUInt16LE(i + 26);
      const extraLen    = zipBuf.readUInt16LE(i + 28);
      const dataStart   = i + 30 + fnLen + extraLen;
      const filename    = zipBuf.slice(i + 30, i + 30 + fnLen).toString('utf8');
      if (filename.toLowerCase().endsWith('.xml')) {
        const compressed = zipBuf.slice(dataStart, dataStart + compSize);
        try {
          const xml = compression === 0
            ? compressed.toString('utf8')
            : require('zlib').inflateRawSync(compressed).toString('utf8');
          chunks.push(xml);
        } catch(e) { console.warn('[ZIP] 압축 해제 실패:', filename); }
      }
      i = dataStart + compSize;
    } else { i++; }
  }
  return chunks.join('\n');
}

// ── 4. XML 파싱 → 매수 신호 추출 (n8n Robust_XML_Parser V8 로직) ──────────
function parseXmlSignals(xml, filing) {
  const signals = [];
  const rowRegex = /<TR[^>]*>([\s\S]*?)<\/TR>/g;
  let match;
  while ((match = rowRegex.exec(xml)) !== null) {
    const row = match[1];
    const reasonMatch = row.match(/<T[UE][^>]*AUNIT="RPT_RSN"[^>]*>([^<]*)<\/T[UE]>/);
    if (!reasonMatch || !reasonMatch[1].includes('(+)')) continue;

    const getVal = (acode) => {
      const re = new RegExp('<TE[^>]*ACODE="' + acode + '"[^>]*>([^<]*)<\/TE>');
      const m  = row.match(re);
      return m ? m[1].replace(/[^0-9]/g, '') : '0';
    };

    const qty        = parseInt(getVal('MDF_STK_CNT')) || 0;
    const unitAmt2   = parseInt(getVal('ACI_AMT2'))    || 0;
    const unitPrc    = parseInt(getVal('UNT_PRC'))      || 0;
    const unitPrice  = unitAmt2 || unitPrc;
    const totalAmount = qty * unitPrice;

    // 5천만원 미만 제외
    if (totalAmount < 50000000) continue;

    const reason = reasonMatch[1].trim();
    const notes  = reason.replace('(+)', '').trim()
      + (unitPrice === 0 && qty > 0 ? ' (단가 미기재/비현금 취득)' : '');
    const jobTitle = filing.pblntf_nm || '';
    const level    = ['대표','의장','회장','사장'].some(k => jobTitle.includes(k)) ? 'High' : 'Low';

    signals.push({
      rcpNo:       filing.rcept_no,
      corpName:    filing.corp_name,
      corpCode:    filing.corp_code,
      stockCode:   filing.stock_code || '',
      reportNm:    filing.report_nm,
      filedAt:     filing.rcept_dt,
      dartUrl:     'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + filing.rcept_no,
      '기업명':    filing.corp_name,
      '종목코드':  filing.stock_code || '',
      '임원명':    filing.flr_nm || '',
      '공시일자':  filing.rcept_dt,
      '임원등급':  level,
      '매수금액(원)': totalAmount,
      '변동사유':  reason,
      '매수일자':  filing.rcept_dt,
      '비고':      notes,
      rcept_no:    filing.rcept_no,
      trade_qty:   qty,
      unit_price:  unitPrice,
      savedAt:     null, // Timestamp은 서버에서 주입
    });
  }
  return signals;
}

// ── 5. Firestore 저장 ─────────────────────────────────────────────────────
async function saveToFirestore(db, signals) {
  if (!signals.length) return 0;
  const { Timestamp } = await import('firebase-admin/firestore');
  const batch = db.batch();
  for (const sig of signals) {
    sig.savedAt = Timestamp.now();
    const docId = sig.rcpNo + '_' + sig.trade_qty + '_' + sig.unit_price;
    batch.set(db.collection('dart_signals').doc(docId), sig, { merge: true });
  }
  await batch.commit();
  return signals.length;
}

// ── 메인 핸들러 ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const auth = req.headers['authorization'];
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!DART_KEY) return res.status(500).json({ error: 'DART_API_KEY 환경변수 없음' });

  try {
    initFirebase();
    const db = getFirestore();
    const { bgn_de, end_de } = getDateRange();
    console.log('[DART] 조회:', bgn_de, '~', end_de);

    const filings = await fetchDartList(bgn_de, end_de);
    console.log('[DART] 공시:', filings.length, '건');

    const allSignals = [];
    let processed = 0;
    for (const filing of filings) {
      try {
        const zip  = await downloadZip(filing.rcept_no);
        const xml  = extractXmlFromZip(zip);
        const sigs = parseXmlSignals(xml, filing);
        allSignals.push(...sigs);
        processed++;
        await new Promise(r => setTimeout(r, 150));
      } catch(e) { console.warn('[DART]', filing.rcept_no, '실패:', e.message); }
    }

    const saved = await saveToFirestore(db, allSignals);
    console.log('[DART] 완료 | 처리:', processed, '신호:', allSignals.length, '저장:', saved);

    return res.status(200).json({
      ok: true, period: bgn_de + '~' + end_de,
      filings: filings.length, processed,
      signals: allSignals.length, saved,
      timestamp: new Date().toISOString(),
    });
  } catch(err) {
    console.error('[DART] 오류:', err);
    return res.status(500).json({ error: err.message });
  }
}
