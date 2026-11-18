// Merges a save with changes someone else made since the editor opened the job.
//   prev: the job as it is stored now
//   base: the job as the editor first loaded it (before their edits)
//   mine: the job the editor is saving
// For every field, the editor's value wins only if they changed it; otherwise the
// stored value is kept. Activity logs are combined so no note is ever dropped.

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const blank = v => v === undefined || v === null || v === '';

function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).sort().filter(k => !blank(v[k])).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const same = (a, b) => (blank(a) && blank(b)) || stable(a) === stable(b);

const logKey = l => [l && l.at, l && l.text, l && l.byName].join('|');
export function unionLog(a, b) {
  const out = [], seen = new Set();
  for (const l of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    const k = logKey(l);
    if (!seen.has(k)) { seen.add(k); out.push(l); }
  }
  return out.sort((x, y) => String((x && x.at) || '').localeCompare(String((y && y.at) || '')));
}

function merge3(prev, base, mine) {
  const out = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(base), ...Object.keys(mine)]);
  for (const k of keys) {
    const p = prev[k], b = base[k], m = mine[k];
    let v;
    if (k === 'log') v = unionLog(p, m);
    else if (isObj(p) && isObj(m)) v = merge3(p, isObj(b) ? b : {}, m);
    else v = same(m, b) ? p : m;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// Returns { job, merged } where merged is true if someone else's changes were kept.
export function mergeJob(prev, base, mine) {
  if (!isObj(prev)) return { job: mine, merged: false };
  if (!isObj(base) || (base.updatedAt || '') === (prev.updatedAt || '')) {
    // No one else saved in between: take the editor's version, but never lose a note.
    return { job: { ...mine, log: unionLog(prev.log, mine.log) }, merged: false };
  }
  return { job: merge3(prev, base, mine), merged: true };
}
