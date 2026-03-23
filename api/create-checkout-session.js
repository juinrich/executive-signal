const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  const origin = req.headers.origin || 'https://executive-signal-seven.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uid, email, plan } = req.body;
  if (!uid || !email || !plan) {
    return res.status(400).json({ error: 'uid, email, plan are required' });
  }

  const priceId =
    plan === 'annual'
      ? process.env.STRIPE_ANNUAL_PRICE_ID
      : process.env.STRIPE_MONTHLY_PRICE_ID;

  if (!priceId) return res.status(500).json({ error: 'Price ID not configured' });

  const baseUrl = process.env.SITE_URL || 'https://executive-signal-seven.vercel.app';

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: baseUrl + '/dashboard.html?payment=success&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: baseUrl + '/dashboard.html?payment=cancel',
    metadata: { uid, plan },
    subscription_data: { metadata: { uid, plan } },
    locale: 'ko',
  });

  res.json({ url: session.url });
};
