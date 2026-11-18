# White Wing job tracker

Built by Reliable Office Services (Reliable OS) for its client **White Wing Inc.**, a supplier of commercial cleaning chemicals, dispensers and equipment. White Wing's owners are Sury Spitzer and Yosef Yaakov ("YY"). The tracker keeps lead follow-ups, site-visit estimates, vendor POs, invoicing and office tasks from slipping. White Wing does all of its estimates, invoices and POs in QuickBooks Online. This app only tracks them by number.

Live: https://white-wing-tracker.vercel.app (password protected)

## Who uses it (read this before changing the UI)
- **Yosef Yaakov** mostly uses the **Tasks** area. He can't read well and isn't comfortable with technology. Keep that area big, simple and built around icons. Use few words, large tap targets and voice input. Don't add fields or clutter to the task form or task cards without a clear reason.
- **Reliable OS staff and Sury** use **Leads & orders** (Needs attention / Pipeline / Weekly summary) and send tasks.
- Many users are on iPhones, so test mobile Safari behavior, especially audio and mic features.

## Stack
- There's no framework and no build step. `index.html` is the whole front end: vanilla JS, inline CSS, Atkinson Hyperlegible font.
- Vercel Node serverless functions live in `api/`, written as ES modules (`"type":"module"`).
- Storage is Vercel Blob (private store `white-wing-tracker-data`, id `store_WSvCr22xbIvYLErZ`, iad1). **Every record lives in one JSON blob, `data/jobs.json`.**
- Brand colors: navy `#2C3A93`, lime `#ADD41A`, cyan `#63CCED`. Light and dark tokens are on `:root`.

## Files
- `api/_lib.js`: auth helpers and Blob read/write.
  - `mutate(fn)` does optimistic concurrency. It reads the etag with `head()`, then writes with `put({ ifMatch })`, and retries up to 6 times when there's a conflict.
  - **Gotcha:** take the etag from `head()`, not from a CDN `get()`. The CDN etag doesn't match `ifMatch`, and saves failed in production because of it.
  - **Gotcha:** never overwrite the blob when the read fails. That would wipe everything.
  - **Daily backups:** the first save each day (UTC) also writes the data as it was *before* that save to `data/backups/YYYY-MM-DD.json`. To restore, copy a backup's contents back over `data/jobs.json` in the Blob store. Backups aren't pruned (one small file a day).
- `api/_merge.js`: `mergeJob(prev, base, mine)` for saves that overlap. If someone else saved the job after the editor opened it, a field takes the editor's value only when the editor changed it; otherwise the stored value stays. Blank, null and missing count as the same value. Activity logs are always combined, so notes never get lost.
- `api/jobs.js`: `GET` lists jobs. `POST {job, base}` upserts one (ids must match `^[A-Za-z0-9_-]{1,64}$`; size capped at 200k chars). `base` is the job as the client first loaded it, and the server merges with it through `mergeJob`. The server sets `updatedAt` and returns `{ok, job, merged}`; the client keeps the returned `job`. `DELETE ?id=` removes one.
- `api/login.js`:
  - `GET` returns `{authed, setup}`.
  - `POST {password}` sets the `wwt` cookie, an HMAC-signed session that lasts 30 days.
  - `DELETE` signs out.
- `api/yiddish.js`: takes `{audio: base64 WAV}` and calls Gemini `generateContent`, which returns `{yiddish, english}`.
  - Models are tried in order, with a fallback list, because Google retires and overloads models often.
  - Set the env var `GEMINI_MODEL` to pin a model.
- `index.html`: sign-in gate plus the app. Routing is hash-based: `#tasks` (the default), `#attention`, `#pipeline`, `#summary`.

## Data model (one record = a "job")
- `type`: `new` (new-customer lead), `reorder` (order from a current customer) or `task`.
- `stage` follows the flow for each type (see `FLOWS` in index.html):
  - new: lead → scheduled → visited → estimate → accepted → po → delivered → invoiced → paid
  - reorder: order → po → delivered → invoiced → paid
  - task: requested (shown as "New") → working ("In process") → done ("Completed")
- `stageDates[stage]` records when the job entered each stage. These dates drive the "stuck too long" flags (`limit` in `STAGES`).
- `nextAction` and `nextDue` hold the next step and its due date. For tasks, `nextAction` is the task name.
- `customer`, `contact`, `phone`, `email`, `industry`, `source`, `vendor`, `estimateNo`, `estimateAmt`, `poNo`, `invoiceNo` and `invoiceAmt` are plain fields.
- `visit{}`, `order{}` and `task{assignee, details, priority, requestedBy, result}` group related fields.
  - `task.assignee` is `"Yosef Yaakov"` or `"Reliable OS"`.
- `log[]` holds `{at, text, byName}` entries. `lost`/`lostAt` mark a lost job. `createdAt` and `updatedAt` are timestamps.
- `CUSTOMERS` in index.html is White Wing's customer list (146 names). The task form's dropdown merges it with the customers already saved on jobs.

## Voice input
- The English mic uses the browser's SpeechRecognition (`en-US`).
- The Yiddish button records with getUserMedia and a ScriptProcessor, encodes 16 kHz mono WAV, base64s it and posts it to `/api/yiddish`.
- The English translation fills the field. The original Yiddish is saved in the log as "Said in Yiddish: …".
- **iPhone gotcha:** the AudioContext must be created and resumed synchronously inside the tap handler, *before* `await getUserMedia`. If it isn't, iOS records silence.

## Environment variables (set in Vercel → Settings → Environment Variables)
- `TRACKER_PASSWORD`: the shared sign-in password.
- `BLOB_READ_WRITE_TOKEN`: Vercel adds this automatically when the Blob store is connected.
- `GEMINI_API_KEY`: Google AI Studio key for the Yiddish translation. Marked sensitive.
- `GEMINI_MODEL` (optional).

Never print, log or commit these values. For local dev, run `vercel env pull .env.local`.

## Commands
- `npm install`
- `npm test`: unit tests for the merge rules, plus a jsdom smoke test with a fake API that uses the real `mergeJob`. It covers the task flow, Undo, overlapping edits, the summary email link and the call/email shortcuts. Run it after any change to index.html or `api/_merge.js`.
- `npm run dev`: `vercel dev`, the local server with the real API (needs `vercel link` and the env vars).
- `npm run deploy`: `vercel --prod`. Before connecting a Git repo, deploys go out through the Vercel CLI. After the repo is connected to the Vercel project, pushing to `main` deploys.

## Vercel
- Project `white-wing-tracker` (`prj_W0QBsDhiXLmoUrk45qzAm552FlWE`)
- Team `reliable-os` (`team_M8Fxw5ExVFWf9EdoeB6tomRR`), Hobby plan. `.vercel/project.json` already links the project.
- Runtime logs on Hobby are kept for only about an hour, so check them right after someone reproduces a problem.

## Conventions
- Write UI copy in plain, short sentences. Error messages tell the user what to do next.
- Keep the app a single, dependency-free `index.html` unless there's a strong reason to split it.
- Run `npm test` before deploying.
