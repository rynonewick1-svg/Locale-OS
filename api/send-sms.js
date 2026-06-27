// Locale — SMS reminder (Twilio)
// Sends a short text reminder to the business owner about jobs needing follow-up.
// SMS gets read fast — this is the most powerful reminder channel, but it costs
// money per message, so it's opt-in and typically a "later" upgrade.
//
// ============================================================================
// EXTERNAL SETUP REQUIRED (one-time, by you):
//  1. Sign up at https://www.twilio.com
//  2. Buy a phone number (small monthly cost) capable of SMS in AU
//  3. From the Twilio console, copy your Account SID + Auth Token
//  4. In Vercel → Environment Variables, add:
//        TWILIO_ACCOUNT_SID = ACxxxx
//        TWILIO_AUTH_TOKEN  = xxxx
//        TWILIO_FROM_NUMBER = +61xxxxxxxxx   (your Twilio number)
//  NOTE: AU SMS may require sender registration depending on Twilio's rules.
// ============================================================================
//
// POST { to, ownerName, count }  →  sends a text. (`to` = owner's mobile, E.164 format e.g. +61400000000)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      diagnostic: true,
      twilio_sid_present: !!process.env.TWILIO_ACCOUNT_SID,
      twilio_token_present: !!process.env.TWILIO_AUTH_TOKEN,
      twilio_from_present: !!process.env.TWILIO_FROM_NUMBER,
      message: (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER)
        ? 'Twilio looks configured.'
        : 'Twilio not fully configured — add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER in Vercel.'
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const SITE = process.env.SITE_URL || 'https://locale-os.vercel.app';

  try {
    const { to, ownerName, count } = req.body || {};
    if (!to) return res.status(400).json({ error: 'Missing recipient number (to)' });

    const n = Number(count) || 1;
    const name = ownerName ? ` ${ownerName}` : '';
    const body = `Hi${name}, you've got ${n} ${n === 1 ? 'job' : 'jobs'} in Locale waiting on a follow-up. A quick nudge today often wins the work. ${SITE}/app — reply STOP to opt out.`;

    if (!sid || !token || !from) {
      return res.status(200).json({ sent: false, preview: body, note: 'Twilio not configured — preview only.' });
    }

    // Twilio REST API — send a message
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ To: to, From: from, Body: body })
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(200).json({ sent: false, error: data, note: 'Twilio rejected the message — check number/registration.' });
    }
    return res.status(200).json({ sent: true, sid: data.sid });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
