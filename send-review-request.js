// Locale — Job Tracker review request email
// Sends a short, warm "would you leave us a review?" email to a customer whose
// job has reached Done/Review in the Job Tracker. This is the last leg of the
// five-stage journey (Recommended) — turning a completed job into proof that
// wins the next one.
//
// This does NOT verify a review was actually left — Google doesn't give us a
// reliable way to confirm that from here. The owner ticks "Review received"
// themselves in the Job Tracker once they see it, same as any other manual
// confirmation step in Locale.
//
// EXTERNAL STEP REQUIRED (one-time, by you — same Resend setup as send-reminder.js):
//   1. Sign up at resend.com (free tier is plenty to start)
//   2. Verify a sending domain (or use the onboarding@resend.dev test sender to start)
//   3. In Vercel → Settings → Environment Variables, add: RESEND_API_KEY = re_xxxxx
//   4. (Optional) FROM_EMAIL = "Locale <noreply@yourdomain.com>"
//
// POST { to, customerName, businessName, reviewLink }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const resendKey = process.env.RESEND_API_KEY;
  const FROM = process.env.FROM_EMAIL || 'Locale <onboarding@resend.dev>';

  try {
    const { to, customerName, businessName, reviewLink } = req.body || {};
    if (!to || typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: 'A valid customer email is required' });
    }
    const biz = (businessName || 'us').toString().slice(0, 120);
    const greeting = customerName ? `Hi ${customerName},` : 'Hi there,';
    const link = reviewLink || '';

    const bodyText =
`${greeting}

Thanks so much for choosing ${biz} — it was a pleasure working with you.

If you had a good experience, a quick Google review would mean a lot to us and helps other locals find us too. It only takes a minute.
${link ? `\n${link}\n` : ''}
Thanks again for your support.

— ${biz}`;

    const linkHtml = link
      ? `<div style="margin-top:18px"><a href="${link}" style="display:inline-block;background:#1f2326;color:#f7f4ef;text-decoration:none;padding:11px 22px;border-radius:999px;font-weight:700;font-size:14px">Leave a review →</a></div>`
      : '';
    const html = `
      <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:8px 4px;color:#1f2326;font-size:15px;line-height:1.65">
        <p style="margin:0 0 12px">${greeting}</p>
        <p style="margin:0 0 12px">Thanks so much for choosing <strong>${biz}</strong> — it was a pleasure working with you.</p>
        <p style="margin:0 0 12px">If you had a good experience, a quick Google review would mean a lot to us and helps other locals find us too. It only takes a minute.</p>
        ${linkHtml}
        <p style="margin:20px 0 0;color:#6d6a63;font-size:13px">Thanks again for your support.<br>— ${biz}</p>
      </div>`;

    if (!resendKey) {
      // Graceful preview mode so the Job Tracker button still works before Resend is connected —
      // the request is recorded as sent in the UI's eyes, but nothing actually goes out yet.
      return res.status(200).json({
        sent: false,
        preview: bodyText,
        note: 'RESEND_API_KEY not set — returning preview only. Add the key in Vercel to actually send.'
      });
    }

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: `How did we do, ${customerName || 'there'}?`,
        text: bodyText,
        html
      })
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(200).json({ sent: false, error: data, note: 'Resend rejected the send — check the from-domain is verified.' });
    }
    return res.status(200).json({ sent: true, id: data.id });
  } catch (e) {
    console.error('api/send-review-request.js error:', e);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
