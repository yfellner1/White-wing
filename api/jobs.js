import { authed, readJobs, mutate, noStore } from './_lib.js';

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export default async function handler(req, res) {
  noStore(res);
  if (!authed(req)) return res.status(401).json({ error: 'Sign in again.' });
  try {
    if (req.method === 'GET') {
      const { jobs } = await readJobs();
      return res.status(200).json({ jobs: Object.entries(jobs).map(([id, j]) => ({ ...j, id })) });
    }
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const job = body && body.job;
      if (!job || typeof job !== 'object' || !ID.test(job.id || '')) return res.status(400).json({ error: 'Invalid job.' });
      if (JSON.stringify(job).length > 200000) return res.status(413).json({ error: 'This job has too much text to save.' });
      const { id, ...rest } = job;
      await mutate(all => { all[id] = rest; });
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const id = String(req.query.id || '');
      if (!ID.test(id)) return res.status(400).json({ error: 'Invalid id.' });
      await mutate(all => { delete all[id]; });
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e && e.message ? e.message : 'Server error' });
  }
}
