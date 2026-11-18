import crypto from 'node:crypto';
import { get, put, head, BlobPreconditionFailedError, BlobNotFoundError } from '@vercel/blob';

const PATH = 'data/jobs.json';
const BACKUP_DIR = 'data/backups/';
const COOKIE = 'wwt';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const hash = s => crypto.createHash('sha256').update(String(s)).digest();
function key() {
  // Changing TRACKER_PASSWORD signs everyone out.
  return hash('wwt-session:' + (process.env.TRACKER_PASSWORD || '') + ':' + (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID || ''));
}
function sig(exp) { return crypto.createHmac('sha256', key()).update(String(exp)).digest('base64url'); }

export function passwordSet() { return !!process.env.TRACKER_PASSWORD; }
export function checkPassword(pw) {
  if (!passwordSet() || typeof pw !== 'string') return false;
  return crypto.timingSafeEqual(hash(pw), hash(process.env.TRACKER_PASSWORD));
}
export function sessionCookie() {
  const exp = Date.now() + MAX_AGE * 1000;
  return `${COOKIE}=${exp}.${sig(exp)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}
export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
export function authed(req) {
  if (!passwordSet()) return false;
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie || '');
  if (!m) return false;
  const [exp, s] = m[1].split('.');
  if (!exp || !s || Number(exp) < Date.now()) return false;
  const a = Buffer.from(s), b = Buffer.from(sig(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const isNotFound = e => e instanceof BlobNotFoundError || (e && e.name === 'BlobNotFoundError');
const isConflict = e => e instanceof BlobPreconditionFailedError || (e && e.name === 'BlobPreconditionFailedError') || /precondition|already exists/i.test(String(e && e.message));

async function currentEtag() {
  // head() reads from the Blob API, so its ETag is the one put({ ifMatch }) checks against.
  try { const h = await head(PATH); return h && h.etag ? h.etag : null; }
  catch (e) { if (isNotFound(e)) return null; throw e; }
}

export async function readJobs() {
  let r = null;
  try { r = await get(PATH, { access: 'private', useCache: false }); } catch (e) { if (isNotFound(e)) r = null; else throw e; }
  if (!r || r.statusCode !== 200 || !r.stream) return { jobs: {}, found: false };
  const text = await new Response(r.stream).text();
  return { jobs: text ? JSON.parse(text) : {}, found: true };
}

// Keeps one snapshot per day (the data as it was before that day's first save),
// so a bad save can be undone by copying a backup back over data/jobs.json.
let backedUpDay = '';
async function backupOnce(before) {
  const day = new Date().toISOString().slice(0, 10);
  if (backedUpDay === day) return;
  try {
    await put(BACKUP_DIR + day + '.json', before, {
      access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false
    });
    backedUpDay = day;
  } catch (e) {
    if (isConflict(e)) backedUpDay = day; // another instance already saved today's backup
    else console.warn('backup failed:', e && e.name, e && e.message);
  }
}

export async function mutate(fn) {
  for (let i = 0; i < 6; i++) {
    const etag = await currentEtag();
    let jobs = {}, before = null;
    if (etag) {
      const r = await readJobs();
      // Never write over saved data we failed to read.
      if (!r.found) { await new Promise(res => setTimeout(res, 250)); continue; }
      jobs = r.jobs;
      before = JSON.stringify(jobs);
    }
    const result = fn(jobs);
    try {
      await put(PATH, JSON.stringify(jobs), {
        access: 'private', contentType: 'application/json', addRandomSuffix: false,
        ...(etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false })
      });
      if (before) await backupOnce(before);
      return result === undefined ? jobs : result;
    } catch (e) {
      console.warn('save attempt', i + 1, 'failed:', e && e.name, e && e.message);
      if (!isConflict(e)) throw e;
      await new Promise(res => setTimeout(res, 120 + Math.random() * 300));
    }
  }
  throw new Error('The tracker is busy. Try saving again.');
}

export function noStore(res) { res.setHeader('Cache-Control', 'no-store'); }
