# White Wing job tracker

Built by Reliable Office Services (Reliable OS) for its client **White Wing Inc.**, a supplier of commercial cleaning chemicals, dispensers and equipment. White Wing's owners are Sury Spitzer and Yosef Yaakov ("YY"). The tracker keeps lead follow-ups, site-visit estimates, vendor POs, invoicing and office tasks from slipping. White Wing does all of its estimates, invoices and POs in QuickBooks Online. This app only tracks them by number.

Live: https://white-wing-tracker.vercel.app (password protected)

## Who uses it (read this before changing the UI)
- **Yosef Yaakov** mostly uses the **Tasks** area. He isn't comfortable with technology, so keep that area very simple and built around icons, with few words, clear tap targets (44px or more) and voice input. He sees fine, so don't make it oversized or heavy: use normal text sizes, light borders and the soft colors. Don't add fields or clutter to the task form or task cards without a clear reason.
- **Reliable OS staff and Sury** use **Leads & orders** (Needs attention / Pipeline / Weekly summary) and send tasks.
- Many users are on iPhones, so test mobile Safari behavior, especially audio and mic features.

## Stack
- There's no framework and no build step. `index.html` is the whole front end: vanilla JS, inline CSS, Atkinson Hyperlegible font.
- Vercel Node serverless functions live in `api/`, written as ES modules (`"type":"module"`).
- Storage is Vercel Blob (private store `white-wing-tracker-data`, id `store_WSvCr22xbIvYLErZ`, iad1). **Every record lives in one JSON blob, `data/jobs.json`.**
- The White Wing logo is `logo.png` (230×36, transparent), shown at 200px wide in the header and on the sign-in card. In dark mode it gets a light backing because its letters are dark. A larger PNG or an SVG would look sharper on retina screens.
- Brand colors: navy `#2C3A93`, lime `#ADD41A`, cyan `#63CCED`. The UI uses softened versions (`--navy #4A58A6`, `--lime #C9E26A`, `--cyan #8FD6EE`) plus light tints (`--sel`, `--soft-lime`, `--soft-cyan`). Selected buttons use the light `--sel` tint, not a solid navy fill. Light and dark tokens are on `:root`.

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
- `api/yiddish.js`: voice for the task description. It takes `{audio: base64 WAV, lang: 'en'|'yi'}` and calls Gemini `generateContent`, which returns `{english, yiddish}` (`yiddish` is empty for `en`).
  - Models are tried in order, with a fallback list, because Google retires and overloads models often. A 503 or 429 moves straight to the next model.
  - **Timeouts:** each try is capped at 20s and the whole request at 50s (`maxDuration` is 60 in `vercel.json`). Before this, overloaded Gemini calls hung until Vercel's 300s limit.
  - Set the env var `GEMINI_MODEL` to put a model first.
- `api/products.js`: signed-in `GET` returns White Wing's product list for the item picker. The data is in `api/_products.js`, generated from the QuickBooks export by `node scripts/import-products.mjs <ProductsServicesList.csv>`. It keeps every item and skips only rows that are exact copies; items with the same name but different prices are both kept. Items with no price come in blank, and their price can be filled in on the task. Fields: `n` name, `d` sales description, `p` price, `v` preferred supplier. Re-run the script when the price list changes.
- `api/remind.js`: the morning text to Yosef Yaakov, sent through Twilio, listing his open tasks that are due today or late (dates in America/New_York).
  - A Vercel cron calls `GET` at 12:00 UTC Sunday to Friday (`vercel.json`; Hobby crons fire sometime within that hour). It's authorized by `Authorization: Bearer $CRON_SECRET`.
  - Signed-in staff can `POST` to send it now; this is the button on the Weekly summary page.
  - Nothing is sent when nothing is due.
- `index.html`: sign-in gate plus the app. Routing is hash-based: `#tasks` (the default), `#attention`, `#pipeline`, `#summary`.

## Data model (one record = a "job")
- `type`: `new` (new-customer lead), `reorder` (order from a current customer) or `task`.
- `stage` follows the flow for each type (see `FLOWS` in index.html):
  - new: lead → scheduled → visited → estimate → accepted → po → delivered → invoiced → paid
  - reorder: order → po → delivered → invoiced → paid
  - task: requested (shown as "New") → working ("In process") → done ("Completed")
- `task.kind` is `order`, `estimate`, `reminder`, `install`, `visit` or `other`.
  - Tasks have no name box. `nextAction` (the title) is built by `autoTitle()` from the kind and customer, e.g. "New order · Kosher Castle". With no customer it's built from the description, e.g. "Reminder: Call the bank".
  - Older tasks with no `kind` keep their typed title.
  - The item picker shows the whole product list when its search box is tapped; typing narrows it down (60 matches shown at most). The totals box shows the items subtotal, shipping, the order total, and a note when items have no price yet (those count as $0).
  - Order and estimate tasks also have `vendor` (Alpha, TCD Parts, CCI or a typed name), `task.items[{name, desc, qty, price}]` with list prices that can be edited, and `task.shipping` (left blank until known).
- `stageDates[stage]` records when the job entered each stage. These dates drive the "stuck too long" flags (`limit` in `STAGES`).
- `nextAction` and `nextDue` hold the next step and its due date. For tasks, `nextAction` is the task name.
- `customer`, `contact`, `phone`, `email`, `industry`, `source`, `vendor`, `estimateNo`, `estimateAmt`, `poNo`, `invoiceNo` and `invoiceAmt` are plain fields.
- `visit{}`, `order{}` and `task{kind, assignee, details, items, shipping, priority, requestedBy, result}` group related fields.
  - `task.assignee` is `"Yosef Yaakov"` or `"Reliable OS"`.
- `log[]` holds `{at, text, byName}` entries. `lost`/`lostAt` mark a lost job. `createdAt` and `updatedAt` are timestamps.
- `CUSTOMERS` in index.html is White Wing's customer list (146 names). The task form's dropdown merges it with the customers already saved on jobs.

## Voice input
- Voice is available only on the task **Description**, through two buttons: 🎤 English and 🎤 ייִדיש.
- Both buttons record with getUserMedia and a ScriptProcessor, encode 16 kHz mono WAV, base64 it and post it with `lang` to `/api/yiddish`. The browser's SpeechRecognition is no longer used because it was unreliable on iPhones.
- The English text is added to the description. Original Yiddish is saved in the log as "Said in Yiddish: …".
- Silent recordings are caught in the browser. If the server is busy or times out, the toast offers "↻ Try again", which resends the same recording, and the client gives up after 65s.
- The microphone only works on HTTPS pages.
- **iPhone gotcha:** the AudioContext must be created and resumed synchronously inside the tap handler, *before* `await getUserMedia`. If it isn't, iOS records silence.

## Environment variables (set in Vercel → Settings → Environment Variables)
- `TRACKER_PASSWORD`: the shared sign-in password.
- `BLOB_READ_WRITE_TOKEN`: Vercel adds this automatically when the Blob store is connected.
- `GEMINI_API_KEY`: Google AI Studio key for the Yiddish translation. Marked sensitive.
- `GEMINI_MODEL` (optional).
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (the Twilio number) and `REMIND_YY_PHONE` (Yosef Yaakov's mobile, in +1… format): for the morning text.
- `CRON_SECRET`: any long random string. Vercel sends it with cron calls.

Never print, log or commit these values. For local dev, run `vercel env pull .env.local`.

## Commands
- `npm install`
- `npm test`: unit tests for the merge rules, plus a jsdom smoke test with a fake API that uses the real `mergeJob`. It also unit-tests the reminder text, and covers the task flow (type, customer, product search, prices, vendor, auto titles), Undo, overlapping edits, the summary email link and the call/email shortcuts. Run it after any change to index.html or `api/_merge.js`.
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
