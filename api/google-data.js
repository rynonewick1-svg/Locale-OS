// Locale — Google data fetch
// Once a user has connected Google (via google-auth → google-callback), this
// endpoint uses their stored tokens to pull real Business Profile data
// (reviews, rating, etc.) to feed their Locale dashboard.
//
// POST { userId }  →  { connected, reviews, rating, ... }
//
// Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE
//
// NOTE: The exact Business Profile API endpoints/shape depend on which Google APIs
// you've enabled and been granted. This function handles the token lifecycle
// (refresh when expired) and gives you a single place to map Google's response
// into the numbers the dashboard shows. The data-mapping block is marked clearly.

async function getValidToken(userId) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE;
  if (!SUPABASE_URL || !SERVICE) return null;

  // Load the stored connection
  const r = await fetch(`${SUPABASE_URL}/rest/v1/google_connections?user_id=eq.${encodeURIComponent(userId)}&select=*`, {
    headers: { 'apikey': SERVICE, 'Authorization': `Bearer ${SERVICE}` }
  });
  const rows = await r.json();
  const conn = Array.isArray(rows) && rows[0];
  if (!conn) return null;

  // Still valid?
  if (conn.access_token && conn.expires_at && Date.now() < conn.expires_at - 60000) {
    return conn.access_token;
  }

  // Refresh it
  if (!conn.refresh_token) return conn.access_token || null;
  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: conn.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  const t = await refreshRes.json();
  if (!refreshRes.ok || !t.access_token) return conn.access_token || null;

  // Save the refreshed token
  const expiresAt = Date.now() + ((t.expires_in || 3600) * 1000);
  await fetch(`${SUPABASE_URL}/rest/v1/google_connections?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE, 'Authorization': `Bearer ${SERVICE}`
    },
    body: JSON.stringify({ access_token: t.access_token, expires_at: expiresAt })
  });
  return t.access_token;
}

export default async function handler(req, res) {
  const _allowed = ['https://locale-os.vercel.app'];
  const _origin = req.headers.origin || '';
  const _ok = _allowed.includes(_origin) || /https:\/\/locale-[a-z0-9-]+\.vercel\.app$/.test(_origin);
  if (_ok) res.setHeader('Access-Control-Allow-Origin', _origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const token = await getValidToken(userId);
    if (!token) {
      return res.status(200).json({ connected: false, note: 'No Google connection for this user yet.' });
    }

    // ========================================================================
    // DATA MAPPING — pull what you need from the Business Profile API here.
    // The available endpoints depend on your granted access. Example shape:
    //
    //   const acc = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
    //     headers: { Authorization: `Bearer ${token}` }
    //   }).then(r => r.json());
    //   ...then fetch locations, then reviews for the location...
    //
    // Map the response into the dashboard's numbers and return them below.
    // Until your API access is granted, this returns connected:true with nulls
    // so the dashboard can show "connected, syncing…" honestly.
    // ========================================================================

    return res.status(200).json({
      connected: true,
      reviews: null,     // map from Business Profile reviews count
      rating: null,      // map from average rating
      views: null,       // map from profile views (if granted)
      note: 'Connected. Map the Business Profile API response in api/google-data.js to populate these.'
    });
  } catch (e) {
    console.error('api/google-data.js error:', e); return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
