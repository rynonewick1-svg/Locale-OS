// Locale — secure serverless Stripe Checkout
// Creates a Stripe Checkout Session and returns the URL to redirect the customer to.
// The Stripe SECRET key lives in an environment variable (STRIPE_SECRET_KEY), never in the browser.
//
// Flow: app calls this -> we create a subscription Checkout Session -> return session.url
// -> app redirects the customer to Stripe's secure payment page.

const PRICE_ID = process.env.STRIPE_PRICE_ID;        // the price_... for the $97/mo plan
const SECRET   = process.env.STRIPE_SECRET_KEY;      // sk_test_... (then sk_live_... at launch)
const TRIAL_DAYS = process.env.STRIPE_TRIAL_DAYS || '14'; // free trial length before the card is charged

// Where Stripe sends the customer after success/cancel.
// Set SITE_URL in Vercel (e.g. https://golocale.com.au or your vercel URL).
const SITE = process.env.SITE_URL || 'https://locale-os.vercel.app';

module.exports = async (req, res) => {
  // CORS (same origin in practice; permissive for the app)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SECRET || !PRICE_ID) {
    return res.status(500).json({ error: 'Stripe not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID in Vercel.' });
  }

  try {
    // The customer's email + Supabase user id, passed from the app so we can
    // tie the subscription back to their account in the webhook.
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const email  = (body && body.email)  || '';
    const userId = (body && body.userId) || '';

    // Build the Checkout Session via Stripe's REST API (form-encoded).
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('line_items[0][price]', PRICE_ID);
    params.append('line_items[0][quantity]', '1');
    params.append('success_url', `${SITE}/app?paid=success`);
    params.append('cancel_url', `${SITE}/app?paid=cancel`);
    if (email) params.append('customer_email', email);
    // Stash the Supabase user id so the webhook can match the payment to the account.
    if (userId) params.append('client_reference_id', userId);
    if (userId) params.append('metadata[supabase_user_id]', userId);
    // IMPORTANT: metadata set above only lives on the Checkout Session. The webhook
    // events that fire later for this subscription (customer.subscription.updated,
    // customer.subscription.deleted — e.g. when a trial converts, a card fails, or
    // someone cancels) receive the Subscription object itself, which does NOT
    // inherit the session's metadata. Without this line, those events could never
    // work out which Locale user they belonged to, so a cancellation or failed
    // trial-conversion charge would silently fail to update their access status.
    if (userId) params.append('subscription_data[metadata][supabase_user_id]', userId);
    // 14-day free trial: the card is collected now (standard Stripe Checkout
    // behaviour for subscriptions) but isn't charged until the trial ends.
    params.append('subscription_data[trial_period_days]', TRIAL_DAYS);
    params.append('allow_promotion_codes', 'true');

    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Stripe checkout error:', data.error && data.error.message);
      return res.status(502).json({ error: (data.error && data.error.message) || 'Stripe error' });
    }

    return res.status(200).json({ url: data.url });
  } catch (e) {
    console.error('checkout.js error:', e);
    return res.status(500).json({ error: 'Server error creating checkout' });
  }
};
