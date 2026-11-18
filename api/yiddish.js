import { authed, noStore } from './_lib.js';

// Voice notes for the task form. lang "yi": Yiddish speech, transcribed and translated to English.
// lang "en": English speech, transcribed. Both go through Gemini so they work the same on every phone.
// Models are tried in order; set GEMINI_MODEL in Vercel to put a specific model first.
const MODELS = [...new Set([process.env.GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3-flash-preview'].filter(Boolean))];
// Google sometimes hangs when it's overloaded. Without limits a request waited until Vercel
// killed it at 300 seconds. Cap each try, and give up on the whole thing well before maxDuration.
const TRY_MS = 20000, TOTAL_MS = 50000;
const MIMES = ['audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/ogg', 'audio/aac', 'audio/flac'];

const PROMPT = `This recording is someone speaking Yiddish (American Hasidic Yiddish, which often mixes in English and Hebrew words) to dictate a short work task or note for White Wing Inc., a supplier of commercial cleaning chemicals, dispensers and cleaning equipment.
1. Transcribe exactly what was said, in Yiddish, using Hebrew letters. Keep English words as they were spoken.
2. Translate it into clear, simple English that reads well as a to-do item or note. Keep names, company names, product names, numbers, amounts and dates exactly as said.
Do not add anything that was not said. If there is no clear speech, return empty strings for both fields.`;
const PROMPT_EN = `This recording is someone speaking English (possibly with a Yiddish or Hebrew accent and a few Yiddish words) to dictate a short work task or note for White Wing Inc., a supplier of commercial cleaning chemicals, dispensers and cleaning equipment.
Write down what was said as clean, simple English. Fix obvious stumbles and filler words, but keep names, company names, product names, numbers, amounts and dates exactly as said. Put any Yiddish words in the "yiddish" field and their meaning in the English text.
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
  const lang = body.lang === 'en' ? 'en' : 'yi';

  const payload = {
    contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: audio } }, { text: lang === 'en' ? PROMPT_EN : PROMPT }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { yiddish: { type: 'STRING' }, english: { type: 'STRING' } }, required: ['yiddish', 'english'] }
    }
  };

  let busy = false;
  const deadline = Date.now() + TOTAL_MS;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - Date.now();
      if (left < 3000) { busy = true; break; }
      let r;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(payload),
          signal: AbortSignal.timeout(Math.min(TRY_MS, left))
        });
      } catch (e) {
        console.error('gemini network error or timeout', model, e && e.name, e && e.message);
        busy = true; break; // a hung model is likely to hang again; move on to the next one
      }
      if (r.status === 404) { console.warn('gemini model not available:', model); break; }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (d && d.error && d.error.message) || '';
        console.error('gemini error', model, r.status, msg);
        if (r.status === 401 || r.status === 403 || /api key/i.test(msg)) return res.status(502).json({ error: 'The translation key isn’t working. Ask Reliable OS to check it.' });
        // Overloaded: move straight to the next model, which is usually free.
        if (r.status === 429 || r.status >= 500) { busy = true; break; }
        return res.status(502).json({ error: 'Couldn’t translate that recording. Try again.' });
      }
      const text = ((d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [])
        .map(p => p.text || '').join('').trim();
      let out;
      try { out = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { out = { english: text, yiddish: '' }; }
      return res.status(200).json({ english: String(out.english || '').trim(), yiddish: lang === 'yi' ? String(out.yiddish || '').trim() : '', model });
    }
  }
  if (busy) return res.status(503).json({ error: 'Google’s voice service is busy right now. Try again in a minute.' });
  console.error('no Gemini model available from', MODELS.join(', '));
  return res.status(502).json({ error: 'Translation isn’t available right now. Ask Reliable OS to check the setup.' });
}
