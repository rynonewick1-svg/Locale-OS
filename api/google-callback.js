// Locale — Google OAuth: STEP 2 (the callback)
// Google redirects here after the owner approves. We exchange the one-time code
// for access + refresh tokens, then store them against the user in Supabase so
// Locale can pull their Business Profile data later.
//
// Requires (same env vars as google-auth.js, plus Supabase service role):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE
//
// It writes to a `google_connections` table. Create it in Supabase:
//   create table google_connections (
//     user_id text primary key,
//     access_token text,
//     refresh_token text,
//     expires_at bigint,
//     updated_at timestamptz default now()
//   );
//   alter table google_connections enable row level security;
//   -- service role bypasses RLS; no public policy needed (server-only access).

export default async function handler(req, res) {
  const code = req.query && req.query.code;
  const state = req.query && req.query.state ? decodeURIComponent(req.query.state) : '';
  const userId = state; // we passed the Locale user id as state

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI
    || `${process.env.SITE_URL || 'https://locale-os.vercel.app'}/api/google-callback`;
  const SITE = process.env.SITE_URL || 'https://locale-os.vercel.app';

  if (!code) return res.status(400).send('Missing authorization code.');
  if (!clientId || !clientSecret) return res.status(500).send('Google not configured on the server.');

  try {
    // Exchange the code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.redirect(`${SITE}/app?google=error`);
    }

    // Persist tokens against the user (server-side, service role).
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE;
    if (SUPABASE_URL && SERVICE && userId) {
      const expiresAt = Date.now() + ((tokens.expires_in || 3600) * 1000);
      await fetch(`${SUPABASE_URL}/rest/v1/google_connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SERVICE,
          'Authorization': `Bearer ${SERVICE}`,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          user_id: userId,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || null,
          expires_at: expiresAt,
          updated_at: new Date().toISOString()
        })
      });
    }

    // Back to the app, flagged connected.
    return res.redirect(`${SITE}/app?google=connected`);
  } catch (e) {
    return res.redirect(`${SITE}/app?google=error`);
  }
}
