// Locale — weekly re-engagement email function (V2)
// Generates a personalised "here's your progress + your next step" digest and sends it.
//
// HOW IT WORKS:
//  - You call this endpoint (manually, or on a schedule via a cron service) with a user's
//    business data. It writes a short, warm, personalised email via Claude, then sends it.
//
// ONE THING YOU MUST CONNECT: an email-sending service.
//  This function is built for RESEND (resend.com) — free tier, dead simple, 1 API key.
//  1. Sign up at resend.com, verify your sending domain (or use their test address to start)
//  2. Create an API key
//  3. In Vercel → Settings → Environment Variables, add:  RESEND_API_KEY = re_xxx
//  (You could swap Resend for SendGrid/Postmark by changing the send block below.)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // DIAGNOSTIC: visit /api/weekly-digest in a browser (GET) to safely check env vars.
  // Shows only whether keys EXIST and their length — never the actual values.
  if (req.method === 'GET') {
    const rk = process.env.RESEND_API_KEY || '';
    const ak = process.env.ANTHROPIC_API_KEY || '';
    return res.status(200).json({
      diagnostic: true,
      resend_key_present: !!rk,
      resend_key_length: rk.length,
      resend_key_starts_with: rk ? rk.slice(0, 3) : null,
      anthropic_key_present: !!ak,
      message: rk
        ? (rk.startsWith('re_') ? 'Resend key looks present and correctly formatted.' : 'A Resend key is present but does NOT start with re_ — wrong value pasted.')
        : 'No Resend key visible to the function — not saved, or deploy has not picked it up yet.'
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  try {
    const { email, business } = req.body || {};
    if (!email || !business) return res.status(400).json({ error: 'Missing email or business data' });

    const b = business;
    const doneCount = (b.actions || []).filter(a => a.done).length;
    const totalCount = (b.actions || []).length;
    const nextAction = (b.actions || []).find(a => !a.done);

    // 1) Generate the email copy with Claude
    const prompt = `You are writing a short, warm, encouraging weekly check-in email from "Locale" to a local business owner using our visibility toolkit. Keep it human, brief (90-130 words), and motivating — like a helpful mate, not a corporate newsletter. No emoji overload (one or two max).
Business: ${b.name}
Current visibility score: ${b.score}/100${b.prevScore ? ` (was ${b.prevScore})` : ''}
Actions completed: ${doneCount} of ${totalCount}
Their next recommended action: ${nextAction ? nextAction.t + ' — ' + nextAction.d : 'none — suggest running a fresh audit'}
Write ONLY the email body (no subject line, no signature). Acknowledge any progress, then point them clearly at their one next step.`;

    const aRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{ role: 'user', content: prompt }] })
    });
    if (!aRes.ok) return res.status(502).json({ error: 'AI generation failed' });
    const aData = await aRes.json();
    const bodyText = (aData.content || []).map(x => x.text || '').join('').trim();

    // Wrap in simple branded HTML
    const html = `
      <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;background:#f7f4ef;padding:32px 28px;border-radius:14px;color:#1f2326">
        <div style="font-size:20px;font-weight:700;color:#2e7d59;margin-bottom:4px">Locale</div>
        <div style="font-size:13px;color:#6d6a63;margin-bottom:20px">Your weekly visibility check-in</div>
        <div style="background:#fffcf7;border:1px solid #ded6c8;border-radius:12px;padding:22px;font-size:15px;line-height:1.65">
          ${bodyText.split('\n').filter(Boolean).map(p => `<p style="margin:0 0 12px">${p}</p>`).join('')}
          <div style="margin-top:18px"><a href="https://locale-os.vercel.app/app" style="display:inline-block;background:#1f2326;color:#f7f4ef;text-decoration:none;padding:11px 22px;border-radius:999px;font-weight:700;font-size:14px">Open your dashboard →</a></div>
        </div>
        <div style="font-size:11px;color:#8a877f;margin-top:18px;text-align:center">You're receiving this because you use Locale. Reply STOP to unsubscribe.</div>
      </div>`;

    // 2) Send via Resend (only if key is configured; otherwise return the generated copy for preview)
    if (!resendKey) {
      return res.status(200).json({ sent: false, preview: bodyText, note: 'RESEND_API_KEY not set — returning preview only. Add the key to actually send.' });
    }

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'Locale <onboarding@resend.dev>', // Resend test sender — works with no domain. Swap to your verified address later.
        to: [email],
        subject: `${b.name}: your visibility this week`,
        html
      })
    });
    if (!sendRes.ok) {
      const t = await sendRes.text();
      return res.status(502).json({ error: 'Send failed', detail: t });
    }
    return res.status(200).json({ sent: true });

  } catch (e) {
    console.error('weekly-digest error', e);
    return res.status(500).json({ error: 'Unexpected error' });
  }
}
