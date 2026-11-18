import { authed, readJobs, noStore } from './_lib.js';

// Morning text to Yosef Yaakov listing his tasks due today or late.
// Runs from the Vercel cron in vercel.json (Sunday to Friday). Staff can also send it
// now from the Weekly summary page (POST, signed in).
// Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (the Twilio number),
//      REMIND_YY_PHONE (Yosef Yaakov's mobile, e.g. +18455550100), CRON_SECRET.
const TZ = 'America/New_York';
const APP_URL = 'https://white-wing-tracker.vercel.app';

export const todayNY = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ });

export function reminderText(jobs, day) {
  const due = Object.values(jobs)
    .filter(j => j && j.type === 'task' && !j.lost && j.stage !== 'done'
      && (j.task || {}).assignee === 'Yosef Yaakov' && j.nextDue && j.nextDue <= day)
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue));
  if (!due.length) return null;
  const lines = due.slice(0, 8).map((j, i) => `${i + 1}. ${j.nextAction || 'Task'}${j.nextDue < day ? ' (late)' : ''}`);
  if (due.length > 8) lines.push(`+ ${due.length - 8} more`);
  return `Good morning! White Wing tasks for today: ${due.length}\n${lines.join('\n')}\n${APP_URL}`;
}

async function sendSMS(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(`Twilio ${r.status}: ${d.message || 'send failed'}`);
  }
}

export default async function handler(req, res) {
  noStore(res);
  const secret = process.env.CRON_SECRET;
  const fromCron = req.method === 'GET' && secret && req.headers.authorization === `Bearer ${secret}`;
  const fromStaff = req.method === 'POST' && authed(req);
  if (!fromCron && !fromStaff) return res.status(401).json({ error: 'Sign in again.' });

  const ready = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'REMIND_YY_PHONE'].every(k => process.env[k]);
  if (!ready) return res.status(503).json({ error: 'Text reminders aren’t set up yet. Ask Reliable OS to add the Twilio settings.' });

  try {
    const { jobs } = await readJobs();
    const text = reminderText(jobs, todayNY());
    if (!text) return res.status(200).json({ ok: true, sent: false, message: 'Nothing is due today, so no text was sent.' });
    await sendSMS(process.env.REMIND_YY_PHONE, text);
    return res.status(200).json({ ok: true, sent: true, message: 'Reminder text sent to Yosef Yaakov.' });
  } catch (e) {
    console.error('reminder failed:', e && e.message);
    return res.status(502).json({ error: 'Couldn’t send the text. Ask Reliable OS to check the Twilio settings.' });
  }
}
