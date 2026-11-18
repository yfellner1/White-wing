// Front-end smoke test: loads index.html in jsdom with a fake API and
// walks through the main task flow. Run with `npm test`.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { mergeJob } from '../api/_merge.js';

// ---- merge rules (server side) ----
{
  const base = { stage: 'requested', nextAction: 'Call Acme', task: { details: '' }, log: [{ at: '1', text: 'Task added' }], updatedAt: 'a' };
  // YY marked it done while the office was editing the details in an open dialog.
  const prev = { ...base, stage: 'done', stageDates: { done: '2026-11-18' }, log: [...base.log, { at: '2', text: 'Status: Completed' }], updatedAt: 'b' };
  const mine = { ...base, task: { details: 'Ask for Moshe' }, log: [...base.log, { at: '3', text: 'Left a message' }] };
  const { job, merged } = mergeJob(prev, base, mine);
  assert.equal(merged, true);
  assert.equal(job.stage, 'done', 'keeps the other person\'s status change');
  assert.equal(job.stageDates.done, '2026-11-18');
  assert.equal(job.task.details, 'Ask for Moshe', 'keeps my edit');
  assert.deepEqual(job.log.map(l => l.text), ['Task added', 'Status: Completed', 'Left a message'], 'no note is lost');
  // An empty form field must not wipe a value someone else filled in.
  const r2 = mergeJob({ ...base, phone: '555-1234', updatedAt: 'b' }, base, { ...base, phone: '' });
  assert.equal(r2.job.phone, '555-1234');
  // No one else saved: my version wins as is.
  const r3 = mergeJob(base, base, { ...mine, stage: 'working' });
  assert.equal(r3.merged, false);
  assert.equal(r3.job.stage, 'working');
}

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let store = [];
const fakeFetch = async (url, opts = {}) => {
  const u = new URL(url, 'https://x.test');
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  if (u.pathname === '/api/login') return json({ authed: true, setup: true });
  if (u.pathname === '/api/jobs') {
    if (!opts.method || opts.method === 'GET') return json({ jobs: store });
    if (opts.method === 'POST') {
      const { job, base } = JSON.parse(opts.body);
      const { id, ...mine } = job, prevJob = store.find(j => j.id === id);
      const strip = o => { if (!o) return o; const { id: _, ...r } = o; return r; };
      const r = mergeJob(strip(prevJob), strip(base), mine);
      r.job.updatedAt = new Date(Date.now() + store.length).toISOString() + Math.random();
      const saved = { ...r.job, id };
      store = store.filter(j => j.id !== id).concat(saved);
      return json({ ok: true, job: saved, merged: r.merged });
    }
    if (opts.method === 'DELETE') { store = store.filter(j => j.id !== u.searchParams.get('id')); return json({ ok: true }); }
  }
  return json({ error: 'not found' }, 404);
};

const dom = new JSDOM(html, {
  url: 'https://x.test/#tasks', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w) {
    w.fetch = fakeFetch;
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  }
});
const { window } = dom, d = window.document;
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const $ = s => d.querySelector(s);

await tick(100);
assert.equal(d.querySelector('.wrap').hidden, false, 'app should show when authed');

// New task with a customer from the dropdown
$('#newTask').click(); await tick();
assert.ok($('#tdlg').open, 'task dialog opens');
$('#tdName').value = 'Sign check for vendor';
const sel = $('#tdCustSel');
assert.ok([...sel.options].some(o => o.value === 'Kosher Castle'), 'customer list populated');
sel.value = 'Kosher Castle'; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
$('#tdSave').click(); await tick(100);
assert.equal(store.length, 1);
assert.equal(store[0].customer, 'Kosher Castle');
assert.equal(store[0].stage, 'requested');

// Status dropdown on the card: working, then done
const statusSel = () => d.querySelector('[data-tstatus]');
statusSel().value = 'working'; statusSel().dispatchEvent(new window.Event('change', { bubbles: true })); await tick(100);
assert.equal(store[0].stage, 'working');
statusSel().value = 'done'; statusSel().dispatchEvent(new window.Event('change', { bubbles: true })); await tick(100);
assert.equal(store[0].stage, 'done');

// Undo puts it back
const undo = $('#toast .toast-act');
assert.ok(undo, 'undo button shows after a status change');
undo.click(); await tick(100);
assert.equal(store[0].stage, 'working', 'undo restores the previous status');
statusSel().value = 'done'; statusSel().dispatchEvent(new window.Event('change', { bubbles: true })); await tick(100);
assert.equal(store[0].stage, 'done');

// Someone else edits the task while it's open here: both changes are kept
d.querySelector('[data-topen]').click(); await tick();
store[0] = { ...store[0], customer: 'Pupa Cheder', updatedAt: 'someone-else', log: [...store[0].log, { at: new Date().toISOString(), text: 'Called them' }] };
$('#tdDetails').value = 'Use the blue checkbook';
$('#tdSave').click(); await tick(100);
assert.equal(store[0].customer, 'Pupa Cheder', 'other person\'s change kept');
assert.equal(store[0].task.details, 'Use the blue checkbook', 'my change kept');
assert.ok(store[0].log.some(l => l.text === 'Called them'), 'other person\'s note kept');

// Leads & orders area shows its own bar
window.location.hash = '#attention'; await tick(60);
assert.equal($('#salesBar').hidden, false);

// Weekly summary counts the task
window.location.hash = '#summary'; await tick(60);
assert.match($('#sumText').value, /Office tasks: 1 requested, 1 completed/);
assert.match($('#mailSum').getAttribute('href'), /^mailto:\?subject=White%20Wing%20weekly%20summary/);

// Call / email shortcuts in the lead form
$('#addBtn').click(); await tick();
$('#f-phone').value = '(845) 555-0100'; $('#f-phone').dispatchEvent(new window.Event('input', { bubbles: true }));
assert.equal($('#callLink').hidden, false);
assert.equal($('#callLink').getAttribute('href'), 'tel:8455550100');
assert.equal($('#mailLink').hidden, true);

console.log('smoke test passed');
process.exit(0);
