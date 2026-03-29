// api/dart-collector.js - JSZip fix
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import JSZip from 'jszip';

function initFirebase() {
  if (getApps().length > 0) return;
  initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n') }) });
}

const DART_KEY = process.env.DART_API_KEY;
const DART_BASE = 'https://opendart.fss.or.kr/api';

function getDateRange() {
  const now = new Date(Date.now() + 9 * 3600000);
  const fmt = (d) => d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2,'0') + String(d.getUTCDate()).padStart(2,'0');
  const end_de = fmt(now);
  const daysBack = now.getUTCDay() === 1 ? 3 : 1;
  return { bgn_de: fmt(new Date(now.getTime() - daysBack * 86400000)), end_de };
}

async function fetchDartList(bgn_de, end_de) {
  const url = new URL(DART_BASE + '/list.json');
  url.searchParams.set('crtfc_key', DART_KEY); url.searchParams.set('pblntf_ty', 'D');
  url.searchParams.set('bgn_de', bgn_de); url.searchParams.set('end_de', end_de);
  url.searchParams.set('page_count', '100'); url.searchParams.set('sort', 'date'); url.searchParams.set('sort_mth', 'desc');
  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.status !== '000') { console.warn('[DART] list 오류:', data.message); return []; }
  return (data.list || []).filter(f => f.stock_code);
}

async function downloadZip(rcptNo) {
  const res = await fetch(DART_BASE + '/document.xml?crtfc_key=' + DART_KEY + '&rcept_no=' + rcptNo);
  if (!res.ok) throw new Error('document.xml HTTP ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

async function extractXmlFromZip(zipBuf) {
  try {
    const zip = await JSZip.loadAsync(zipBuf);
    const chunks = [];
    for (const [filename, file] of Object.entries(zip.files)) {
      if (filename.toLowerCase().endsWith('.xml') && !file.dir) {
        try { chunks.push(await file.async('string')); }
        catch(e) { console.warn('[ZIP] 압축 해제 실패:', filename, e.message); }
      }
    }
    return chunks.join('\n');
  } catch(e) { console.warn('[ZIP] 로드 실패:', e.message); return ''; }
}

function parseXmlSignals(xml, filing) {
  const signals = [];
  const rowRegex = /<TR[^>]*>([\s\S]*?)<\/TR>/g;
  let match;
  while ((match = rowRegex.exec(xml)) !== null) {
    const row = match[1];
    const reasonMatch = row.match(/<T[UE][^>]*AUNIT="RPT_RSN"[^>]*>([^<]*)<\/T[UE]>/);
    if (!reasonMatch || !reasonMatch[1].includes('(+)')) continue;
    const getVal = (acode) => { const re = new RegExp('<TE[^>]*ACODE="' + acode + '"[^>]*>([^<]*)<\/TE>'); const m = row.match(re); return m ? m[1].replace(/[^0-9]/g,'') : '0'; };
    const qty = parseInt(getVal('MDF_STK_CNT'))||0, unitAmt2 = parseInt(getVal('ACI_AMT2'))||0, unitPrc = parseInt(getVal('UNT_PRC'))||0;
    const unitPrice = unitAmt2 || unitPrc, totalAmount = qty * unitPrice;
    if (totalAmount < 50000000) continue;
    const reason = reasonMatch[1].trim();
    const level = ['대표','의장','회장','사장'].some(k => (filing.pblntf_nm||'').includes(k)) ? 'High' : 'Low';
    signals.push({ rcpNo: filing.rcept_no, corpName: filing.corp_name, corpCode: filing.corp_code, stockCode: filing.stock_code||'', reportNm: filing.report_nm, filedAt: filing.rcept_dt, dartUrl: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+filing.rcept_no, '기업명': filing.corp_name, '종목코드': filing.stock_code||'', '임원명': filing.flr_nm||'', '공시일자': filing.rcept_dt, '임원등급': level, '매수금액(원)': totalAmount, '변동사유': reason, '매수일자': filing.rcept_dt, '비고': reason.replace('(+)','').trim(), rcept_no: filing.rcept_no, trade_qty: qty, unit_price: unitPrice, savedAt: null });
  }
  return signals;
}

async function saveToFirestore(db, signals) {
  if (!signals.length) return 0;
  const { Timestamp } = await import('firebase-admin/firestore');
  const batch = db.batch();
  for (const sig of signals) { sig.savedAt = Timestamp.now(); batch.set(db.collection('dart_signals').doc(sig.rcpNo+'_'+sig.trade_qty+'_'+sig.unit_price), sig, { merge: true }); }
  await batch.commit();
  return signals.length;
}

export default async function handler(req, res) {
  const auth = req.headers['authorization'];
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
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
        const zip = await downloadZip(filing.rcept_no);
        const xml = await extractXmlFromZip(zip);
        const sigs = parseXmlSignals(xml, filing);
        allSignals.push(...sigs);
        processed++;
        await new Promise(r => setTimeout(r, 150));
      } catch(e) { console.warn('[DART]', filing.rcept_no, '실패:', e.message); }
    }
    const saved = await saveToFirestore(db, allSignals);
    console.log('[DART] 완료 | 처리:', processed, '신호:', allSignals.length, '저장:', saved);
    return res.status(200).json({ ok: true, period: bgn_de+'~'+end_de, filings: filings.length, processed, signals: allSignals.length, saved, timestamp: new Date().toISOString() });
  } catch(err) { console.error('[DART] 오류:', err); return res.status(500).json({ error: err.message }); }
  }
