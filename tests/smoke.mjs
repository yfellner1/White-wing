// Front-end smoke test: loads index.html in jsdom with a fake API and
// walks through the main task flow. Run with `npm test`.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let store = [];
const fakeFetch = async (url, opts = {}) => {
  const u = new URL(url, 'https://x.test');
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  if (u.pathname === '/api/login') return json({ authed: true, setup: true });
  if (u.pathname === '/api/jobs') {
    if (!opts.method || opts.method === 'GET') return json({ jobs: store });
    if (opts.method === 'POST') { const { job } = JSON.parse(opts.body); store = store.filter(j => j.id !== job.id).concat(job); return json({ ok: true }); }
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

// Leads & orders area shows its own bar
window.location.hash = '#attention'; await tick(60);
assert.equal($('#salesBar').hidden, false);

// Weekly summary counts the task
window.location.hash = '#summary'; await tick(60);
assert.match($('#sumText').value, /Office tasks: 1 requested, 1 completed/);

console.log('smoke test passed');
process.exit(0);
