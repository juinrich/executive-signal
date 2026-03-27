const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        : undefined,
    }),
  });
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || 'https://executive-signal-seven.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sessionId, uid } = req.body;
  if (!sessionId || !uid) return res.status(400).json({ error: 'sessionId and uid required' });

  try {
    // Stripe에서 세션 직접 조회하여 결제 확인
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    // 보안: 메타데이터 uid와 요청 uid 일치 확인
    if (session.metadata && session.metadata.uid !== uid) {
      return res.status(403).json({ error: 'UID mismatch' });
    }

    // Firestore 즉시 업데이트 (webhook 대기 불필요)
    const db = admin.firestore();
    await db.collection('users').doc(uid).set({
      subscription: {
        status: 'active',
        plan: (session.metadata && session.metadata.plan) || 'monthly',
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription,
        activatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }
    }, { merge: true });

    console.log('Subscription activated for uid:', uid);
    res.json({ success: true, status: 'active' });
  } catch (err) {
    console.error('Activation error:', err);
    res.status(500).json({ error: err.message });
  }
};
