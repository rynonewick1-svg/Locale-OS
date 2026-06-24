// Locale — Stripe webhook
// Stripe calls THIS url whenever something happens (payment succeeded, subscription
// cancelled, etc). We verify it's really Stripe, then update the customer's
// subscription status in Supabase so the paywall knows who has access.
//
// Env vars needed in Vercel:
//   STRIPE_SECRET_KEY        sk_test_... (then live)
//   STRIPE_WEBHOOK_SECRET    whsec_...  (from the webhook you create in Stripe)
//   SUPABASE_URL             your project url
//   SUPABASE_SERVICE_ROLE    the service_role key (server-only! never in the app)

const SECRET         = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SERVICE_ROLE   = process.env.SUPABASE_SERVICE_ROLE;

// We need the raw body to verify Stripe's signature, so disable body parsing.
module.exports.config = { api: { bodyParser: false } };

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Verify the Stripe-Signature header (HMAC SHA256) without the Stripe SDK.
const crypto = require('crypto');
function verify(raw, sig, secret) {
  if (!sig) return false;
  const parts = Object.fromEntries(sig.split(',').map(kv => kv.split('=')));
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  const signed = `${t}.${raw}`;
  const expected = crypto.createHmac('sha256', secret).update(signed, 'utf8').digest('hex');
  // constant-time compare
  const a = Buffer.from(expected); const b = Buffer.from(v1);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Update (or insert) the subscription status for a user in Supabase.
async function setStatus(userId, email, status) {
  if (!userId && !email) { console.error('setStatus: no userId and no email — nothing to write'); return; }
  const url = `${SUPABASE_URL}/rest/v1/subscriptions`;
  const row = {
    user_id: userId || null,
    email: email || null,
    status: status,            // 'active' | 'canceled' | 'past_due'
    updated_at: new Date().toISOString()
  };
  console.log('setStatus writing:', JSON.stringify(row));
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_ROLE,
      'Authorization': `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'   // upsert on the unique user_id
    },
    body: JSON.stringify(row)
  });
  if (!resp.ok) {
    const txt = await resp.text();
    console.error('Supabase write FAILED:', resp.status, txt);
  } else {
    console.log('Supabase write OK:', resp.status);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!SECRET || !WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_ROLE) {
    console.error('Webhook missing env vars');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  const raw = await readRaw(req);
  const sig = req.headers['stripe-signature'];
  if (!verify(raw, sig, WEBHOOK_SECRET)) {
    console.error('Webhook signature verification failed');
    return res.status(400).json({ error: 'Bad signature' });
  }

  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).end(); }

  try {
    const obj = event.data && event.data.object ? event.data.object : {};
    switch (event.type) {
      case 'checkout.session.completed': {
        const userId = obj.client_reference_id || (obj.metadata && obj.metadata.supabase_user_id) || '';
        const email  = obj.customer_email || (obj.customer_details && obj.customer_details.email) || '';
        console.log('checkout.session.completed — userId:', userId || '(none)', 'email:', email || '(none)');
        await setStatus(userId, email, 'active');
        break;
      }
      case 'customer.subscription.updated': {
        const email = '';
        const userId = (obj.metadata && obj.metadata.supabase_user_id) || '';
        const status = obj.status === 'active' || obj.status === 'trialing' ? 'active'
                     : obj.status === 'past_due' ? 'past_due' : 'canceled';
        await setStatus(userId, email, status);
        break;
      }
      case 'customer.subscription.deleted': {
        const userId = (obj.metadata && obj.metadata.supabase_user_id) || '';
        await setStatus(userId, '', 'canceled');
        break;
      }
      default:
        // ignore other events
        break;
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('Webhook handler error:', e);
    return res.status(500).json({ error: 'handler error' });
  }
};
