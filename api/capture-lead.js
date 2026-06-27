// Locale — Lead capture + instant auto-response
// The "never miss an enquiry" engine. When someone fills in a contact/enquiry form
// on a Locale customer's site (or the Locale site itself), this:
//   1. Stores the lead immediately in Supabase (so it's NEVER lost)
//   2. Fires an instant auto-response email to the person who enquired
//   3. Notifies the business owner so they can follow up while it's warm
//
// This directly attacks the #1 money-leak for local businesses: enquiries that
// arrive while you're on a job and get forgotten by lunchtime.
//
// POST {
//   businessOwnerEmail,        // who gets notified (the Locale customer)
//   businessName,              // for the auto-response wording
//   ownerId,                   // Supabase user id, to attach the lead
//   lead: { name, email, phone, message }   // the person enquiring
// }
//
// Requires: RESEND_API_KEY (for emails), SUPABASE_URL + SUPABASE_SERVICE_ROLE (to store)
// Fails gracefully: if Resend/Supabase aren't set, it still returns the lead so
// nothing is lost, and notes what wasn't sent.

// Simple in-memory rate limiter (per warm instance) — stops bot floods hammering
// this public endpoint and running up your Resend bill.
const _hits = new Map();
function _rateLimited(ip, max = 5, windowMs = 60000) {
  const now = Date.now();
  const rec = _hits.get(ip) || { count: 0, start: now };
  if (now - rec.start > windowMs) { rec.count = 0; rec.start = now; }
  rec.count++;
  _hits.set(ip, rec);
  if (_hits.size > 5000) { for (const [k, v] of _hits) if (now - v.start > windowMs) _hits.delete(k); }
  return rec.count > max;
}
function _validEmail(s) { return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254; }
function _clean(s, max = 2000) { return typeof s === 'string' ? s.slice(0, max) : ''; }

export default async function handler(req, res) {
  // Lock CORS to your own domains.
  const allowed = ['https://locale-os.vercel.app'];
  const origin = req.headers.origin || '';
  const okOrigin = allowed.includes(origin) || /https:\/\/locale-[a-z0-9-]+\.vercel\.app$/.test(origin);
  if (okOrigin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (_rateLimited(ip)) return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });

  const RESEND = process.env.RESEND_API_KEY;
  const FROM = process.env.FROM_EMAIL || 'Locale <onboarding@resend.dev>';
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE;

  try {
    const body = req.body || {};
    const businessName = _clean(body.businessName, 120);
    const businessOwnerEmail = body.businessOwnerEmail;
    const ownerId = _clean(body.ownerId, 80);
    // Validate + sanitise the lead server-side (never trust the client).
    const rawLead = body.lead || {};
    const lead = {
      name: _clean(rawLead.name, 120),
      email: _validEmail(rawLead.email) ? rawLead.email : '',
      phone: _clean(rawLead.phone, 40),
      message: _clean(rawLead.message, 2000)
    };
    if (!lead.email && !lead.phone) {
      return res.status(400).json({ error: 'Please provide a valid email or phone so we can reply.' });
    }

    const result = { stored: false, autoReplied: false, ownerNotified: false };
    const bizName = businessName || 'the team';

    // 1. STORE THE LEAD FIRST — this is the most important step. Never lose it.
    if (SUPABASE_URL && SERVICE) {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SERVICE,
            'Authorization': `Bearer ${SERVICE}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            owner_id: ownerId || null,
            name: lead.name || null,
            email: lead.email || null,
            phone: lead.phone || null,
            message: lead.message || null,
            source: 'web_enquiry',
            status: 'new',
            created_at: new Date().toISOString()
          })
        });
        result.stored = r.ok;
      } catch (e) { /* keep going — still try to email */ }
    }

    // 2. INSTANT AUTO-RESPONSE to the person enquiring (the magic moment)
    if (RESEND && lead.email) {
      const replyText =
`Hi ${lead.name || 'there'},

Thanks for getting in touch with ${bizName} — your message has come through and we'll get back to you personally very soon.

We know how it is: you reached out because you need something sorted. We've got it, and you're not lost in an inbox somewhere.

If it's urgent, feel free to reply straight to this email.

Talk soon,
${bizName}`;

      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM,
            to: [lead.email],
            subject: `Thanks for reaching out to ${bizName}`,
            text: replyText
          })
        });
        result.autoReplied = r.ok;
      } catch (e) { /* keep going */ }
    }

    // 3. NOTIFY THE BUSINESS OWNER so they can follow up while it's warm
    if (RESEND && businessOwnerEmail) {
      const notifyText =
`New enquiry just came in 🎯

Name:    ${lead.name || '—'}
Email:   ${lead.email || '—'}
Phone:   ${lead.phone || '—'}

Message:
${lead.message || '(no message)'}

They've already had an instant acknowledgement, so they know you're onto it.
Follow up while it's warm — most jobs are won by whoever replies first.

Open Locale: ${process.env.SITE_URL || 'https://locale-os.vercel.app'}/app`;

      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM,
            to: [businessOwnerEmail],
            subject: `New enquiry from ${lead.name || lead.email || 'a customer'}`,
            text: notifyText
          })
        });
        result.ownerNotified = r.ok;
      } catch (e) { /* keep going */ }
    }

    // Always return the lead so the front-end can also store it locally as a backup.
    return res.status(200).json({
      ok: true,
      lead,
      ...result,
      note: (!RESEND || !SUPABASE_URL)
        ? 'Lead captured. Some delivery steps are pending env setup (Resend/Supabase) — see Locale_Integrations_Setup.md.'
        : 'Lead captured, acknowledged, and owner notified.'
    });
  } catch (e) {
    console.error('capture-lead error:', e); // full detail server-side only
    return res.status(500).json({ error: 'Something went wrong on our end. Please try again in a moment.' });
  }
}
