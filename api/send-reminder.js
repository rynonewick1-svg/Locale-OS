// Locale — Job Tracker follow-up reminder email
// Sends a simple, friendly "these jobs need a follow-up" nudge to the business owner.
//
// This is the outbound channel that makes Job Tracker reminders reach the owner
// even when they're NOT in the app. It is OPT-IN — only called for owners who have
// turned reminders on in their notification settings.
//
// EXTERNAL STEP REQUIRED (one-time, by you):
//   1. Sign up at resend.com (free tier is plenty to start)
//   2. Verify a sending domain — ideally noreply@golocale.com.au once you own it
//      (to start, Resend gives you an onboarding@resend.dev test sender)
//   3. Create an API key, then in Vercel → Settings → Environment Variables add:
//        RESEND_API_KEY = re_xxxxx
//   4. (Optional) set FROM_EMAIL = "Locale <noreply@yourdomain.com>"
//
// HOW IT'S CALLED:
//   POST { email, ownerName, businessName, jobs: [{customer, job, value, stage}] }
//   `jobs` should be the ones flagged needs-follow-up. The app builds this list and
//   calls the endpoint (e.g. on a daily cron, or a "remind me" button).

export default async function handler(req, res) {
  const _allowed = ['https://locale-os.vercel.app'];
  const _origin = req.headers.origin || '';
  const _ok = _allowed.includes(_origin) || /https:\/\/locale-[a-z0-9-]+\.vercel\.app$/.test(_origin);
  if (_ok) res.setHeader('Access-Control-Allow-Origin', _origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Safe diagnostic (GET) — checks the key exists, never reveals it.
  if (req.method === 'GET') {
    const rk = process.env.RESEND_API_KEY || '';
    return res.status(200).json({
      diagnostic: true,
      resend_key_present: !!rk,
      resend_key_starts_with: rk ? rk.slice(0, 3) : null,
      message: rk
        ? (rk.startsWith('re_') ? 'Resend key present and well-formed.' : 'Key present but not starting with re_ — wrong value.')
        : 'No Resend key visible yet — add RESEND_API_KEY in Vercel and redeploy.'
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const resendKey = process.env.RESEND_API_KEY;
  const FROM = process.env.FROM_EMAIL || 'Locale <onboarding@resend.dev>';

  try {
    const { email, ownerName, businessName, jobs } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Missing email' });
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return res.status(200).json({ sent: false, note: 'No jobs need follow-up — nothing to send.' });
    }

    const greeting = ownerName ? `Hi ${ownerName},` : 'Hi there,';
    const count = jobs.length;
    const jobLines = jobs.map(j => {
      const val = j.value ? ` — $${Number(j.value).toLocaleString('en-AU')}` : '';
      const stage = j.stage ? ` (${j.stage})` : '';
      return `• ${j.customer || 'A customer'}: ${j.job || 'job'}${val}${stage}`;
    }).join('\n');

    const bodyText =
`${greeting}

You've got ${count} ${count === 1 ? 'job' : 'jobs'} in Locale waiting on a follow-up. A quick nudge today is often the difference between winning the work and losing it to silence:

${jobLines}

Most jobs are won on the second or third follow-up — a 30-second message could be all it takes.

Open Locale to follow up:
${process.env.SITE_URL || 'https://locale-os.vercel.app'}/app

— Locale
You're receiving this because follow-up reminders are switched on. You can turn them off any time in Settings.`;

    const html = bodyText
      .split('\n')
      .map(line => line.trim() === '' ? '<br>' : `<p style="margin:0 0 10px;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1f2326">${line.replace('<','&lt;')}</p>`)
      .join('');

    if (!resendKey) {
      // Graceful preview mode so the app works before the key is added.
      return res.status(200).json({
        sent: false,
        preview: bodyText,
        note: 'RESEND_API_KEY not set — returning preview only. Add the key in Vercel to actually send.'
      });
    }

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject: `${count} ${count === 1 ? 'job needs' : 'jobs need'} a follow-up`,
        text: bodyText,
        html: `<div style="max-width:520px;margin:0 auto">${html}</div>`
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(200).json({ sent: false, error: data, note: 'Resend rejected the send — check the from-domain is verified.' });
    }
    return res.status(200).json({ sent: true, id: data.id });
  } catch (e) {
    console.error('api/send-reminder.js error:', e); return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
