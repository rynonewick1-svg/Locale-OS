// Locale — env var diagnostic (SAFE: never reveals secret values, only presence/length)
// Visit /api/env-check in your browser. Delete this file before launch.

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const check = (name) => {
    const v = process.env[name];
    return {
      present: typeof v === 'string' && v.length > 0,
      length: v ? v.length : 0,
      // show only the first 7 chars so you can confirm it's the right *type* of key
      // (e.g. "sk_test", "price_1", "whsec_") without exposing the secret
      prefix: v ? v.slice(0, 7) : null
    };
  };
  res.status(200).json({
    STRIPE_SECRET_KEY:     check('STRIPE_SECRET_KEY'),
    STRIPE_PRICE_ID:       check('STRIPE_PRICE_ID'),
    STRIPE_WEBHOOK_SECRET: check('STRIPE_WEBHOOK_SECRET'),
    SUPABASE_URL:          check('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE: check('SUPABASE_SERVICE_ROLE'),
    SITE_URL:              check('SITE_URL'),
    ANTHROPIC_API_KEY:     check('ANTHROPIC_API_KEY'),
    note: 'Values are never shown — only whether each var is present, its length, and a short prefix to confirm type.'
  });
};
