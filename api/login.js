import { passwordSet, checkPassword, sessionCookie, clearCookie, authed, noStore } from './_lib.js';

export default async function handler(req, res) {
  noStore(res);
  if (req.method === 'GET') return res.status(200).json({ authed: authed(req), setup: passwordSet() });
  if (req.method === 'DELETE') { res.setHeader('Set-Cookie', clearCookie); return res.status(200).json({ ok: true }); }
  if (req.method === 'POST') {
    if (!passwordSet()) return res.status(503).json({ error: 'The tracker password hasn’t been set up yet.' });
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    if (!checkPassword(body && body.password)) {
      await new Promise(r => setTimeout(r, 600));
      return res.status(401).json({ error: 'That password didn’t work. Try again.' });
    }
    res.setHeader('Set-Cookie', sessionCookie());
    return res.status(200).json({ ok: true });
  }
  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
