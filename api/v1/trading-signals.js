/**
 * GET /api/v1/trading-signals
 *
 * Signal-X 봇 연동용 종목 추천 API 엔드포인트
 *
 * - Firestore dart_signals에서 최근 임원 매수 공시 데이터를 가져옴
 * - 매수 금액, 임원 등급, 거래량 기반 종합 점수(total_score) 산출
 * - 기술적 지표 시뮬레이션 + 매매 셋업(진입가, 손절가, 목표가) 자동 계산
 * - Bearer 토큰 인증으로 봇만 접근 가능
 *
 * Auth: Authorization: Bearer <TRADING_BOT_TOKEN>
 * Cache: 60초 revalidate
 */

const admin = require('firebase-admin');

// ── Firebase 초기화 ────────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}
const db = admin.firestore();

// ── 인증 미들웨어 ────────────────────────────────────
function authenticate(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  const secret = process.env.TRADING_BOT_TOKEN;

  if (!secret) {
    return { ok: false, error: 'TRADING_BOT_TOKEN 환경변수가 설정되지 않았습니다.' };
  }
  if (!token || token !== secret) {
    return { ok: false, error: '인증 실패: 유효하지 않은 토큰입니다.' };
  }
  return { ok: true };
}

// ── KST 오늘 날짜 (YYYYMMDD) ────────────────────────
function getTodayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

// ── 최근 N 영업일 날짜 범위 계산 ─────────────────
function getDateRange(daysBack = 3) {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setDate(kst.getDate() - daysBack);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

// ── 종합 점수 산출 (total_score) ─────────────────
function calculateTotalScore(signals) {
  const grouped = {};

  for (const sig of signals) {
    const key = sig['종목코드'] || sig.stockCode || 'UNKNOWN';
    if (!grouped[key]) {
      grouped[key] = {
        symbol: key,
        name: sig['기업명'] || sig.corpName || '',
        corpCode: sig.corpCode || '',
        signals: [],
        totalAmount: 0,
        highGradeCount: 0,
        transactionCount: 0,
      };
    }
    const g = grouped[key];
    g.signals.push(sig);
    g.totalAmount += Number(sig['매수금액(원)'] || 0);
    g.transactionCount += 1;
    if (sig['임원등급'] === 'High') g.highGradeCount += 1;
  }

  const results = [];

  for (const [symbol, data] of Object.entries(grouped)) {
    const amountScore = Math.min(40, Math.round((data.totalAmount / 100000000) * 40));
    const gradeRatio = data.transactionCount > 0 ? data.highGradeCount / data.transactionCount : 0;
    const gradeScore = Math.round(gradeRatio * 30);
    const countScore = Math.min(20, Math.round((data.transactionCount / 3) * 20));

    const today = getTodayKST();
    const latestDate = data.signals
      .map(s => s.filedAt || s['공시일자'] || '')
      .sort()
      .pop();
    let recencyScore = 0;
    if (latestDate === today) recencyScore = 10;
    else if (latestDate >= getDateRange(1)) recencyScore = 5;
    else recencyScore = 2;

    const totalScore = amountScore + gradeScore + countScore + recencyScore;

    let signal;
    if (totalScore >= 80) signal = '강력매수';
    else if (totalScore >= 60) signal = '매수';
    else if (totalScore >= 40) signal = '중립';
    else signal = '관망';

    const technical = generateTechnicalIndicators(totalScore);
    const avgPrice = calculateAvgPrice(data.signals);
    const tradeSetup = generateTradeSetup(avgPrice, totalScore);

    const insiderDetails = data.signals.map(s => ({
      name: s['임원명'] || '',
      grade: s['임원등급'] || '',
      amount: Number(s['매수금액(원)'] || 0),
      quantity: Number(s.trade_qty || 0),
      unitPrice: Number(s.unit_price || 0),
      reason: s['변동사유'] || '',
      date: s['매수일자'] || s.filedAt || '',
    }));

    results.push({
      symbol: symbol,
      name: data.name,
      signal: signal,
      total_score: totalScore,
      score_breakdown: {
        amount: amountScore,
        grade: gradeScore,
        count: countScore,
        recency: recencyScore,
      },
      technical_indicators: technical,
      trade_setup: tradeSetup,
      insider_summary: {
        total_amount: data.totalAmount,
        transaction_count: data.transactionCount,
        high_grade_ratio: Math.round(gradeRatio * 100) + '%',
      },
      insider_details: insiderDetails,
      dart_url: data.signals[0]?.dartUrl || '',
    });
  }

  results.sort((a, b) => b.total_score - a.total_score);
  return results;
}

// ── 기술적 지표 시뮬레이션 ────────────────────────
// TODO: 실제 시세 API (KIS, KRX 등) 연동 시 대체 예정
function generateTechnicalIndicators(score) {
  const baseRsi = 50 - (score - 50) * 0.4;
  const rsi = Math.max(10, Math.min(90, baseRsi + (Math.random() * 10 - 5)));
  const stochastic = Math.max(5, Math.min(95, rsi - 5 + (Math.random() * 10)));
  const bollingerB = Math.max(0, Math.min(1,
    (100 - score) / 100 * 0.5 + (Math.random() * 0.2 - 0.1)
  ));

  return {
    rsi: Math.round(rsi * 10) / 10,
    stochastic: Math.round(stochastic * 10) / 10,
    bollinger_b: Math.round(bollingerB * 100) / 100,
    _note: 'simulated — 실제 시세 API 연동 전 시뮬레이션 값',
  };
}

// ── 평균 매수 단가 계산 ──────────────────────────
function calculateAvgPrice(signals) {
  let totalCost = 0;
  let totalQty = 0;
  for (const s of signals) {
    const qty = Number(s.trade_qty || 0);
    const price = Number(s.unit_price || 0);
    if (qty > 0 && price > 0) {
      totalCost += qty * price;
      totalQty += qty;
    }
  }
  return totalQty > 0 ? Math.round(totalCost / totalQty) : 0;
}

// ── 매매 셋업 생성 ───────────────────────────────
// CLAUDE.md 전략: 손절 -0.7%, 익절 +1.5%부터 분할매도
function generateTradeSetup(avgPrice, score) {
  if (avgPrice <= 0) {
    return {
      entry_price: 0,
      stop_loss: 0,
      target_1: 0,
      target_2: 0,
      _note: '매수 단가 정보 없음 — 실시간 시세로 대체 필요',
    };
  }

  const discountRate = score >= 80 ? 0.995 : score >= 60 ? 0.99 : 0.985;
  const entryPrice = Math.round(avgPrice * discountRate);
  const stopLoss = Math.round(entryPrice * (1 - 0.007));
  const target1 = Math.round(entryPrice * (1 + 0.015));
  const target2 = Math.round(entryPrice * (1 + 0.030));

  return {
    entry_price: entryPrice,
    stop_loss: stopLoss,
    target_1: target1,
    target_2: target2,
    risk_reward_ratio: Math.round((target1 - entryPrice) / (entryPrice - stopLoss) * 100) / 100,
  };
                                                   }

// ── 메인 핸들러 ────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', error: 'Method Not Allowed' });
  }

  const auth = authenticate(req);
  if (!auth.ok) {
    return res.status(401).json({ status: 'error', error: auth.error });
  }

  try {
    const daysBack = parseInt(req.query.days || '3', 10);
    const minScore = parseInt(req.query.min_score || '70', 10);
    const signalFilter = req.query.signal || '';
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);

    const fromDate = getDateRange(daysBack);
    const snap = await db.collection('dart_signals')
      .where('filedAt', '>=', fromDate)
      .orderBy('filedAt', 'desc')
      .orderBy('매수금액(원)', 'desc')
      .limit(100)
      .get();

    if (snap.empty) {
      return res.status(200).json({
        timestamp: new Date().toISOString(),
        status: 'success',
        count: 0,
        data: [],
        meta: { message: '조회 기간 내 임원 매수 공시가 없습니다.', from_date: fromDate },
      });
    }

    const signals = snap.docs.map(doc => doc.data());
    let results = calculateTotalScore(signals);
    results = results.filter(r => r.total_score >= minScore);

    if (signalFilter) {
      results = results.filter(r => r.signal === signalFilter);
    }

    results = results.slice(0, limit);

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      status: 'success',
      count: results.length,
      data: results,
      meta: {
        from_date: fromDate,
        min_score: minScore,
        signal_filter: signalFilter || 'all',
        cache_ttl: '60s',
        version: '1.0.0',
      },
    });

  } catch (err) {
    console.error('[trading-signals] 에러:', err);
    return res.status(500).json({
      timestamp: new Date().toISOString(),
      status: 'error',
      error: '서버 내부 오류가 발생했습니다.',
      detail: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};
