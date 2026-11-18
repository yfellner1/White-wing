import { authed, noStore } from './_lib.js';

// Tried in order; set GEMINI_MODEL in Vercel to pin a specific model.
const MODELS = [...new Set([process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-flash-lite-latest', 'gemini-pro-latest', 'gemini-2.5-flash'].filter(Boolean))];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIMES = ['audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/ogg', 'audio/aac', 'audio/flac'];

const PROMPT = `This recording is someone speaking Yiddish (American Hasidic Yiddish, which often mixes in English and Hebrew words) to dictate a short work task or note for White Wing Inc., a supplier of commercial cleaning chemicals, dispensers and cleaning equipment.
1. Transcribe exactly what was said, in Yiddish, using Hebrew letters. Keep English words as they were spoken.
2. Translate it into clear, simple English that reads well as a to-do item or note. Keep names, company names, product names, numbers, amounts and dates exactly as said.
Do not add anything that was not said. If there is no clear speech, return empty strings for both fields.`;

export default async function handler(req, res) {
  noStore(res);
  if (!authed(req)) return res.status(401).json({ error: 'Sign in again.' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  // Tolerate stray spaces, line breaks or quotes from copy-paste.
  const key = String(process.env.GEMINI_API_KEY || '').trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (!key) return res.status(503).json({ error: 'Yiddish voice isn’t set up yet. Ask Reliable OS to add the translation key.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const audio = body && body.audio;
  if (typeof audio !== 'string' || audio.length < 1000) return res.status(400).json({ error: 'No recording was received. Try again.' });
  if (audio.length > 4000000) return res.status(413).json({ error: 'That recording is too long. Keep it under a minute and a half.' });
  const mime = MIMES.includes(body.mime) ? body.mime : 'audio/wav';

  const payload = {
    contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: audio } }, { text: PROMPT }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { yiddish: { type: 'STRING' }, english: { type: 'STRING' } }, required: ['yiddish', 'english'] }
    }
  };

  let busy = false;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let r;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(payload)
        });
      } catch (e) {
        console.error('gemini network error', model, e && e.message);
        busy = true; await sleep(600); continue;
      }
      if (r.status === 404) { console.warn('gemini model not available:', model); break; }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (d && d.error && d.error.message) || '';
        console.error('gemini error', model, r.status, msg);
        if (r.status === 401 || r.status === 403 || /api key/i.test(msg)) return res.status(502).json({ error: 'The translation key isn’t working. Ask Reliable OS to check it.' });
        if (r.status === 429 || r.status >= 500) { busy = true; if (attempt === 0 && r.status >= 500) { await sleep(800); continue; } break; }
        return res.status(502).json({ error: 'Couldn’t translate that recording. Try again.' });
      }
      const text = ((d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [])
        .map(p => p.text || '').join('').trim();
      let out;
      try { out = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { out = { english: text, yiddish: '' }; }
      return res.status(200).json({ english: String(out.english || '').trim(), yiddish: String(out.yiddish || '').trim(), model });
    }
  }
  if (busy) return res.status(503).json({ error: 'Google’s translation is busy right now. Wait a minute and try again.' });
  console.error('no Gemini model available from', MODELS.join(', '));
  return res.status(502).json({ error: 'Translation isn’t available right now. Ask Reliable OS to check the setup.' });
}
