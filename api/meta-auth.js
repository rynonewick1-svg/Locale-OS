// Locale — Meta (Facebook / Instagram) OAuth: STEP 1 (start the connection)
// Redirects the business owner to Facebook's consent screen to connect their
// Facebook Page and linked Instagram Business account.
//
// ============================================================================
// EXTERNAL SETUP REQUIRED (one-time, by you — this is the gated part, and Meta's
// app review is strict and can take weeks):
// ============================================================================
//  1. Go to https://developers.facebook.com → create an app (type: Business).
//  2. Add the "Facebook Login" and "Instagram Graph API" products.
//  3. In App Settings, add your domain and a Privacy Policy URL (REQUIRED).
//  4. Configure the OAuth redirect URI:
//        https://locale-os.vercel.app/api/meta-callback
//  5. Request the permissions you need (these require App Review by Meta):
//        - pages_show_list, pages_read_engagement
//        - instagram_basic, instagram_manage_insights (for IG data)
//  6. Copy the App ID + App Secret into Vercel → Environment Variables:
//        META_APP_ID = xxxx
//        META_APP_SECRET = xxxx        (server-side only — never in front-end)
//        META_REDIRECT_URI = https://locale-os.vercel.app/api/meta-callback
//
//  NOTE: Until Meta approves your app + permissions, only app "test users" /
//        admins can connect. Public use needs Meta's full App Review. This is
//        genuinely slow — plan for weeks, and possible back-and-forth.
// ============================================================================

export default function handler(req, res) {
  const appId = process.env.META_APP_ID;
  const redirectUri = process.env.META_REDIRECT_URI
    || `${process.env.SITE_URL || 'https://locale-os.vercel.app'}/api/meta-callback`;

  if (!appId) {
    return res.status(200).json({
      ready: false,
      note: 'Facebook/Instagram connection not configured yet. Add META_APP_ID, META_APP_SECRET and META_REDIRECT_URI in Vercel (see the setup notes at the top of api/meta-auth.js).'
    });
  }

  // Readiness check mode (no redirect) so the front-end can show "coming soon" cleanly.
  if (req.query && req.query.check) {
    return res.status(200).json({ ready: true });
  }

  const uid = (req.query && req.query.uid) ? String(req.query.uid) : '';
  const state = encodeURIComponent(uid);
  const scope = encodeURIComponent('pages_show_list,pages_read_engagement,instagram_basic,instagram_manage_insights');

  const url =
    'https://www.facebook.com/v19.0/dialog/oauth' +
    `?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scope}` +
    '&response_type=code' +
    `&state=${state}`;

  res.writeHead(302, { Location: url });
  res.end();
}
