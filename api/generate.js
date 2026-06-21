// Locale — secure serverless proxy for the Claude API
// Runs on Vercel. Your API key lives in an environment variable, never in the browser.

// Simple in-memory rate limiter (per warm instance). For stronger limits across
// all instances, upgrade to Vercel KV or Upstash Redis later — noted in the guide.
const hits = new Map();
const WINDOW_MS = 60 * 1000;      // 1 minute window
const MAX_PER_WINDOW = 8;         // max requests per IP per minute

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { count: 0, start: now };
  if (now - rec.start > WINDOW_MS) {
    rec.count = 0;
    rec.start = now;
  }
  rec.count++;
  hits.set(ip, rec);
  // Opportunistic cleanup so the map doesn't grow forever
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now - v.start > WINDOW_MS) hits.delete(k);
  }
  return rec.count > MAX_PER_WINDOW;
}

// Allowed task types and their token ceilings — prevents abuse via huge requests
const TASK_LIMITS = {
  audit: 1600,
  reviews: 800,
  content: 1400,
  report: 1200,
};

export default async function handler(req, res) {
  // Lock CORS to your own domains. Add your custom domain here when you have one.
  const allowedOrigins = [
    'https://locale-os.vercel.app',
  ];
  const origin = req.headers.origin || '';
  // Allow any *.vercel.app preview of this project, plus the explicit list
  const okOrigin = allowedOrigins.includes(origin) || /https:\/\/locale-[a-z0-9-]+\.vercel\.app$/.test(origin);
  if (okOrigin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server not configured. Add ANTHROPIC_API_KEY in Vercel settings.' });

  try {
    const { prompt, task } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing prompt' });
    }
    if (prompt.length > 6000) {
      return res.status(400).json({ error: 'Prompt too long' });
    }
    const maxTokens = TASK_LIMITS[task] || 1200;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const txt = await anthropicRes.text();
      console.error('Anthropic error', anthropicRes.status, txt);
      return res.status(502).json({ error: 'AI service error. Please try again.' });
    }

    const data = await anthropicRes.json();
    const text = (data.content || []).map(b => b.text || '').join('');
    return res.status(200).json({ text });

  } catch (err) {
    console.error('Handler error', err);
    return res.status(500).json({ error: 'Unexpected error. Please try again.' });
  }
}
