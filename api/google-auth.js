// Locale — Google OAuth: STEP 1 (start the connection)
// Redirects the business owner to Google's consent screen to connect their
// Google Business Profile (reviews, profile views, search data) to Locale.
//
// ============================================================================
// EXTERNAL SETUP REQUIRED (one-time, by you — this is the gated part):
// ============================================================================
//  1. Go to https://console.cloud.google.com → create a project ("Locale").
//  2. APIs & Services → Enable APIs → enable:
//        - "Google Business Profile API"  (for reviews / profile data)
//        - (later) "Google Analytics Data API" if you want site analytics too
//  3. APIs & Services → OAuth consent screen:
//        - User type: External
//        - App name: Locale,  support email, your logo
//        - Add your domain (golocale.com.au) once you have it
//        - Add a Privacy Policy URL (REQUIRED for verification)
//        - Scopes: add 'https://www.googleapis.com/auth/business.manage'
//        - Add yourself + any pilot clients as "Test users" to use it
//          BEFORE Google's full verification (which can take weeks).
//  4. APIs & Services → Credentials → Create OAuth client ID:
//        - Type: Web application
//        - Authorised redirect URI:
//            https://locale-os.vercel.app/api/google-callback
//          (and your real domain version once live)
//  5. Copy the Client ID + Client Secret into Vercel → Environment Variables:
//        GOOGLE_CLIENT_ID = xxxx.apps.googleusercontent.com
//        GOOGLE_CLIENT_SECRET = xxxx        (server-side only — never in front-end)
//        GOOGLE_REDIRECT_URI = https://locale-os.vercel.app/api/google-callback
//
//  NOTE: Until Google verifies the app, only your added "test users" can connect.
//        That's fine for a pilot. Full public use needs Google's verification.
// ============================================================================

export default function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI
    || `${process.env.SITE_URL || 'https://locale-os.vercel.app'}/api/google-callback`;

  if (!clientId) {
    return res.status(200).json({
      ready: false,
      note: 'Google connection not configured yet. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI in Vercel (see the setup notes at the top of api/google-auth.js).'
    });
  }

  // `state` carries the Locale user id so the callback knows who connected.
  // The app should pass ?uid=<supabaseUserId> when linking to this endpoint.
  const uid = (req.query && req.query.uid) ? String(req.query.uid) : '';
  const state = encodeURIComponent(uid);

  const scope = encodeURIComponent('https://www.googleapis.com/auth/business.manage');
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    '&response_type=code' +
    `&scope=${scope}` +
    '&access_type=offline' +     // get a refresh token
    '&prompt=consent' +          // ensure refresh token is returned
    `&state=${state}`;

  res.writeHead(302, { Location: url });
  res.end();
}
