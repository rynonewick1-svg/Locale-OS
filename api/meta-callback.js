// Locale — Meta (Facebook / Instagram) OAuth: STEP 2 (the callback)
// Meta redirects here after the owner approves. We exchange the code for an
// access token and store it against the user in Supabase.
//
// Requires: META_APP_ID, META_APP_SECRET, META_REDIRECT_URI,
//           SUPABASE_URL, SUPABASE_SERVICE_ROLE
//
// Writes to a `social_connections` table. Create it in Supabase:
//   create table social_connections (
//     user_id text,
//     platform text,           -- 'facebook' | 'instagram'
//     access_token text,
//     expires_at bigint,
//     updated_at timestamptz default now(),
//     primary key (user_id, platform)
//   );
//   alter table social_connections enable row level security;
//   -- service role bypasses RLS; no public policy (server-only access).

export default async function handler(req, res) {
  const code = req.query && req.query.code;
  const state = req.query && req.query.state ? decodeURIComponent(req.query.state) : '';
  const userId = state;

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI
    || `${process.env.SITE_URL || 'https://locale-os.vercel.app'}/api/meta-callback`;
  const SITE = process.env.SITE_URL || 'https://locale-os.vercel.app';

  if (!code) return res.status(400).send('Missing authorization code.');
  if (!appId || !appSecret) return res.status(500).send('Meta not configured on the server.');

  try {
    // Exchange code for an access token
    const tokenUrl =
      'https://graph.facebook.com/v19.0/oauth/access_token' +
      `?client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&client_secret=${encodeURIComponent(appSecret)}` +
      `&code=${encodeURIComponent(code)}`;
    const tokenRes = await fetch(tokenUrl);
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.access_token) {
      return res.redirect(`${SITE}/app?social=error`);
    }

    // Persist (server-side, service role)
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE;
    if (SUPABASE_URL && SERVICE && userId) {
      const expiresAt = Date.now() + ((tokens.expires_in || 3600) * 1000);
      await fetch(`${SUPABASE_URL}/rest/v1/social_connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SERVICE,
          'Authorization': `Bearer ${SERVICE}`,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          user_id: userId,
          platform: 'facebook',
          access_token: tokens.access_token,
          expires_at: expiresAt,
          updated_at: new Date().toISOString()
        })
      });
    }

    return res.redirect(`${SITE}/app?social=connected`);
  } catch (e) {
    console.error('meta-callback error:', e);
    return res.redirect(`${SITE}/app?social=error`);
  }
}
