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
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(400).send('Webhook Error: ' + err.message);
  }

  const db = admin.firestore();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const uid = session.metadata && session.metadata.uid;
        if (uid) {
          await db.collection('users').doc(uid).set({
            subscription: {
              status: 'active',
              plan: (session.metadata && session.metadata.plan) || 'monthly',
              stripeCustomerId: session.customer,
              stripeSubscriptionId: session.subscription,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
          }, { merge: true });
          console.log('Activated subscription for uid:', uid);
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const uid = sub.metadata && sub.metadata.uid;
        if (uid) {
          const isActive = sub.status === 'active' || sub.status === 'trialing';
          await db.collection('users').doc(uid).set({
            subscription: {
              status: isActive ? 'active' : 'inactive',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
          }, { merge: true });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const uid = sub.metadata && sub.metadata.uid;
        if (uid) {
          await db.collection('users').doc(uid).set({
            subscription: {
              status: 'canceled',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
          }, { merge: true });
          console.log('Canceled subscription for uid:', uid);
        }
        break;
      }
    }
  } catch (err) {
    console.error('Firestore error:', err);
    return res.status(500).json({ error: 'Database update failed' });
  }

  res.json({ received: true });
};

module.exports.config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
