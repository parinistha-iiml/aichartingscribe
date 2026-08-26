# AI Charting Scribe — Demo Build

A voice-first clinical documentation web app, built to the capstone build spec:
doctor picks a patient, dictates an encounter, and the app produces (a) a
structured clinical note + discharge summary and (b) a plain-language,
optionally translated patient summary — with a single doctor review/approve
gate before "sending" (mocked EHR write-back — see Scope below).

The AI pipeline makes real calls to real services: Azure AI Speech for
transcription, Azure AI Language (Text Analytics for Health) for clinical
entity extraction, Azure AI Document Intelligence for OCR, Azure AI
Translator for patient-summary translation, and Groq (an LLM) for one
specific free-text field-mapping task. Every one of these runs on that
service's always-free tier — no paid subscription or payment method
required anywhere in the pipeline. Data persistence is also real —
patients, encounters, and the audit log live in Neon Postgres via Prisma,
not memory.

All patient data is synthetic — no real PHI, per spec.

## AI Services

Each service below is called live when its API key is set in `server/.env`.
If a key is missing, the app doesn't fake a response — it fails loudly and
tells you exactly what's missing (`GET /api/health` reports the status of
every service at any time, and the server logs the same on startup).

| Service | Used for | Free tier |
|---|---|---|
| Azure AI Speech | Speech-to-text on the doctor's dictation | ~5 audio hrs/month (F0) |
| Azure AI Language — Text Analytics for Health | Extracting symptoms, medications, diagnosis + ICD-10 from the transcript | 5,000 text records (F0) |
| Azure AI Document Intelligence | OCR for scanned discharge-template images | 500 pages/month (F0) |
| Azure AI Translator | Translating the patient summary (Hindi/Marathi/Tamil/Bengali) | 2M characters/month (F0) |
| Groq (`openai/gpt-oss-120b`) | Mapping dictation onto a hospital template's free-text fields (Investigations, Diet, Miscellaneous, etc.) | Free tier, API key only |

**There is deliberately no generative model anywhere in the note/discharge/patient-summary
pipeline itself.** Discharge-summary and patient-summary generation are template + entity
population sourced directly from the doctor's own dictation (`server/clinicalKnowledge.js`) —
that's an extraction/templating task, not a text-generation task, so it doesn't need a model that
would otherwise require a paid Azure AI Foundry deployment (Microsoft's own docs: free/trial Azure
subscriptions can't deploy those). Groq is used for exactly one narrower job — mapping a
transcript onto a template's own free-text fields that have no fixed clinical schema — with a
prompt explicitly instructed never to invent facts the doctor didn't say, and falls back to
keyword/regex matching against the transcript if `GROQ_API_KEY` isn't set.

Set up your own free keys:
- Azure: [Azure AI Speech](https://azure.microsoft.com/products/ai-services/ai-speech), [Language](https://azure.microsoft.com/products/ai-services/ai-language) (enable Text Analytics for Health), [Document Intelligence](https://azure.microsoft.com/products/ai-services/ai-document-intelligence), [Translator](https://azure.microsoft.com/products/ai-services/ai-translator) — each on the F0 (free) pricing tier
- Groq: [console.groq.com/keys](https://console.groq.com/keys)

## Stack

- **Frontend:** React + Tailwind (Vite)
- **Backend:** Node.js/Express
- **Database:** Neon (serverless Postgres) via **Prisma ORM**
- **AI:** real Azure AI Speech / Language / Document Intelligence / Translator calls, plus Groq for template field-mapping — see [AI Services](#ai-services) above

## Screens

1. **Login / Sign up** — real credentials: email + password (bcrypt-hashed), stored in the `Doctor` table. New doctors self-register with name, email, password, and specialty.
2. Patient Queue (+ **New Encounter**, + per-patient **History**, + **Add patient** — new patients are written to the `Patient` table, not just seeded)
3. Pre-Consult Brief (M0) — dynamically built from the patient's last *approved* encounter (diagnosis, meds, summary given last time); falls back to the seeded 3-line summary for a first-ever visit
4. Dictation (M1/M2) — mic recording (MediaRecorder) or file upload, transcribed via Azure AI Speech. **Every take is appended to a reviewable dictation log** (timestamp + transcript) rather than overwriting a single field — doctors can dictate more than once (addenda/corrections) before continuing
5. Structured Note (M3/M4) — editable entities extracted via Azure Text Analytics for Health; discharge summary is **auto-populated from an uploaded hospital template** (`{{placeholders}}` filled from the structured note/patient/doctor/date, with free-text fields mapped via Groq) when one is selected, or a generic free-text draft otherwise
6. Patient Summary (M5) — plain-language summary side-by-side with clinical note, + Hindi/Marathi/Tamil/Bengali translation via Azure AI Translator
7. Review & Approve (M6) — **maker-checker gate**: the dictating doctor (maker) reviews the AI-vs-edited diff and submits for check; a second doctor (checker) reviews the same diff read-only and either approves & sends (mocked EHR write-back) or sends it back to the maker with a note
8. Audit Log (M8) — maker-submitted / checker-approved timestamps + full field-level change history

Two screens sit outside the linear flow, reachable anytime from the header/queue:
- **Discharge templates** — upload the hospital's *existing* discharge document (PDF or scanned image) and it's read + turned into a reusable `{{placeholder}}` format automatically — nobody types a template by hand. Patient-specific values (name, ID/record numbers, phone, address) are auto-blanked, with a mandatory review step before anything is saved (see "Templates from real documents" below).
- **Patient History** — a patient's past approved visits (diagnosis, meds, the patient-facing summary they were given) for reference at follow-ups

## Database setup (Neon + Prisma)

1. **Create a Neon project** at [neon.tech](https://neon.tech) (free tier is plenty for this demo).
2. From the Neon dashboard, open **Connection Details** and copy two connection
   strings:
   - the **pooled** connection (has `-pooler` in the hostname) → `DATABASE_URL`
   - the **direct** connection (no `-pooler`) → `DIRECT_URL` (Prisma Migrate
     needs a direct connection; it can't run migrations through the pooler)
3. In `server/`, copy the template and fill in both values, plus the AI service keys
   from the [AI Services](#ai-services) section above:
   ```bash
   cd server
   cp .env.example .env
   # edit .env and paste in your Neon connection strings + AI service API keys
   ```
   Note: in Prisma 7, connection URLs are no longer set in `schema.prisma`.
   `prisma.config.ts` (used by the CLI for migrate/studio/seed) reads
   `DIRECT_URL`, and `db.js` (used by the running app) builds a
   `@prisma/adapter-neon` driver adapter from `DATABASE_URL`. You still need
   both values in `.env` — nothing else to configure.
4. Install dependencies, generate the Prisma client, and run the migration
   (this creates the `Doctor`, `Patient`, `Encounter`, and `AuditLogEntry`
   tables in your Neon database):
   ```bash
   npm install
   npx prisma generate
   npx prisma migrate dev --name init
   ```
5. Seed the demo doctors and synthetic patients:
   ```bash
   npx prisma db seed
   ```
   (or `npm run seed`)

You can inspect the data anytime with `npx prisma studio`.

## Templates from real documents

Hospitals don't hand-type a `{{placeholder}}` template — they have an existing discharge
document. `POST /api/templates/from-document` (`server/templatize.js`) handles that:

- **PDF with a text layer** → extracted directly with `pdf-parse` (works offline, no
  external API).
- **Scanned image** → OCR via Azure AI Document Intelligence (`prebuilt-read` model) when
  `AZURE_DOCUMENT_INTELLIGENCE_KEY`/`_ENDPOINT` are set; PDF template upload works either way
  since it needs no external API.
- The extracted text is matched against a curated list of common discharge-summary field labels
  (Name of Patient, IP No, Diagnosis, Medication, Follow up, ...) and every value is replaced with
  a `{{placeholder}}` — so the saved template has the hospital's structure, not any specific
  patient's data.
- A safety net also blanks stray identifiers that land outside a recognized label (10-digit phone
  numbers, `HOSPITALCODE.123456`-style record IDs).
- **Nothing is saved automatically.** The result is returned to the doctor for review/edit in the
  Discharge Templates screen — only an explicit "Save template" click persists it. Regex-based
  field-matching from real-world OCR text can't be guaranteed perfect, so this review step is
  load-bearing, not decorative.

Tested end-to-end against a real de-identified hospital discharge PDF during development — 25
fields detected, all patient-identifying values (name, IP number, mobile number, address, record
ID) confirmed blanked in the output. That source document was not retained anywhere in this repo.

## Data model

- `Doctor` — real accounts: `name`, unique `email`, bcrypt `passwordHash`, `specialty`
- `Patient` — reference data; creatable via the UI/API, not just seeded
- `DictationLog` — one row per dictation take, append-only, tied to an encounter
- `DischargeTemplate` — hospital-uploaded discharge formats with `{{placeholder}}` fields
- `Encounter` — the structured note, discharge summary, patient summary/translation, `status` (`draft` → `pending_checker` → `approved`, or back to `draft` on checker reject), and maker/checker timestamps
- `AuditLogEntry` — field-level change history per encounter

## Auth

Real credentials: `POST /api/auth/signup` (name, email, password, specialty) creates a
`Doctor` row with a bcrypt-hashed password; `POST /api/auth/login` (email, password) verifies it.
Passwords are never returned by the API. There's no session/JWT layer — a successful login just
returns the doctor record, which the frontend holds in memory for that browser session (refreshing
the page logs you out). That's a reasonable line for a demo; a real deployment would add a signed
session token on top of this.

After `npx prisma db seed`, all three seeded doctors share the password `demo1234` (see the seed
script's console output for their emails) so you can log in immediately without signing up first.

## Running locally

Two processes, two terminals:

```bash
# Terminal 1 — backend (port 4000)
cd server
npm start
# GET http://localhost:4000/api/health should report { db: "connected", services: {...} }
# — check this to see which AI services are live vs not configured
```

```bash
# Terminal 2 — frontend (port 5173, proxies /api to :4000)
cd client
npm install
npm run dev
```

Then open the URL Vite prints (typically http://localhost:5173).

To build the frontend for static hosting:

```bash
cd client
npm run build   # outputs to client/dist
```

## Scope (per spec)

- No real EHR/FHIR integration — "Approve & Send" only flips `status` to `approved`.
- No real patient audio capture — self-dictation only.
- No production PHI redaction — synthetic patient names/data only.
- No session/JWT layer on top of login (see Auth above).
