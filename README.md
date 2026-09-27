# ER Angel

**ER patients deteriorate silently in waiting rooms — nobody's watching. ER Angel re-checks vitals automatically and tells the nurse the moment something changes.**

A check-in kiosk captures a contactless vitals baseline (Presage) at triage. Every rescan is compared against that baseline by Gemini, which reasons about deterioration and pushes a plain-English, prioritized alert to a nurse dashboard — including a FAST-inspired facial asymmetry check for stroke screening, not just heart rate.

Built for [hackathon name] — targeting Best Use of Gemini API, Best Use of Presage, Best Use of Vultr, and Best Use of ElevenLabs.

---

## How it works

```
┌─────────────────┐      camera       ┌───────────────────┐
│  Kiosk (React)   │ ───────────────▶ │  presage-agent      │
│  check-in +      │                   │  (local Node        │
│  rescan screens  │ ◀─────────────── │  process, owns       │
└────────┬─────────┘   heart rate,     │  the camera)        │
         │             breathing rate, └──────────────────────┘
         │             facial asymmetry,
         │             EDA/stress
         ▼
┌──────────────────┐
│  Backend API      │──▶ SQLite (patients, readings, alerts)
│  (Express)        │
│                    │──▶ Gemini (risk classification + nurse-facing alert text)
│                    │──▶ ElevenLabs (kiosk voice updates, text-to-speech)
│                    │──▶ Object storage / DB backup [confirm]
└────────┬───────────┘
         │ polls
         ▼
┌──────────────────┐
│  Nurse Dashboard   │
│  (React)           │
└────────────────────┘
```

**Why `presage-agent` is a separate process:** Presage's SmartSpectra SDK is native/Node, not a browser package — it needs direct OS-level camera access, which a browser tab can't grant to arbitrary code. So `presage-agent` runs as its own local process on the kiosk device itself (next to the physical webcam), and the kiosk browser calls its local HTTP API (`localhost:4600`) to get a reading, then forwards those numbers to the main backend exactly like any other reading. The main backend, dashboard, and database can live anywhere (e.g. Vultr); only `presage-agent` is tied to the kiosk hardware.

---

## What it measures

| Signal | Source | Notes |
|---|---|---|
| Heart rate | Presage `cardioMetrics` | rPPG, contactless |
| Breathing rate | Presage `breathingMetrics` | needs chest visible in frame, camera should be stable/mounted |
| Facial asymmetry (stroke screening) | Presage `faceMetrics` landmarks + custom geometry (`presage-agent/src/faceAsymmetry.js`) | Inspired by the "F" in FAST (Face, Arms, Speech, Time). Compared **relative to that patient's own baseline**, not an absolute threshold — everyone has natural asymmetry. **Not a diagnosis** — a supplementary signal for a nurse to look at. |
| EDA / stress score | Presage `edaMetrics` | Electrodermal activity; field shape confirmed via live diagnostic logging in `presage-agent`, not from public docs |

Every reading after the first is compared to that patient's **triage baseline**, not to a population norm. Comparison and risk scoring happen in `backend/src/services/geminiRisk.js` (primary path) with a rule-based fallback in `backend/src/logic/riskThresholds.js` if Gemini is unavailable — both use the same thresholds so alert behavior is consistent either way.

---

## Voice (ElevenLabs)

The kiosk speaks to the patient — check-in confirmation, rescan instructions, PA-style announcements — using ElevenLabs text-to-speech instead of static pre-recorded clips, so prompts can be dynamic (e.g. referencing the patient's own check-in number) without needing an actor or a recording session.

- `backend/src/services/elevenLabsTts.js` — generates speech audio from text via the ElevenLabs API
- `frontend-kiosk/src/lib/voice.js` + `useAnnouncer.js` — plays prompts on the kiosk, one line per screen, and surfaces PA-style announcements (e.g. recheck reminders) via `AnnouncementBanner`
- A mute toggle (`MuteToggle` component) is available in the kiosk UI

*(Whoever owns `elevenLabsTts.js` — worth confirming here which voice/model is used and whether audio is cached or generated fresh per prompt.)*

---

## Project layout

```
er-angel/
├── backend/              Express API, SQLite, Gemini integration, risk logic
├── presage-agent/        Local capture agent — MUST run on the kiosk device with the camera
├── frontend-kiosk/        Patient-facing check-in / rescan flow (browser)
├── frontend-dashboard/   Nurse-facing alert dashboard (browser)
├── docs/                 Architecture notes, demo script
├── deploy/ / infra/       [confirm — deployment/infra config, e.g. Vultr]
├── scripts/               [confirm — top-level utility scripts]
└── test_output.json       [confirm — sample/fixture data?]
```

### `backend/src/`
- `index.js` — Express entrypoint, route registration
- `db/` — SQLite connection + schema (`patients`, `readings`, `alerts`)
- `routes/` — `checkin`, `readings`, `patients`, `alerts`, `admin` (reset/seed), plus `calls` and `speak` [confirm — voice/PA-related endpoints]
- `services/` — `geminiRisk.js` (risk classification), `geminiAlertText.js` (nurse-facing one-liner), `geminiIntake.js` (intake chatbot, stretch), `geminiClient.js` [confirm — shared Gemini client setup?], `elevenLabsTts.js` (ElevenLabs text-to-speech for kiosk voice updates), `calls.js`, `recordReading.js`, `dbBackup.js` [confirm], `objectStorage.js` [confirm]
- `logic/` — `riskThresholds.js` (rule-based fallback), `edaAlert.js` [confirm — EDA-specific alert rules], `recheck.js` [confirm — scheduled recheck logic], `demoSeed.js` (demo patient seeding), `envFlags.js` [confirm — feature flag helpers], `sqliteTime.js` [confirm — timestamp helpers]

### `presage-agent/src/`
- `index.js` — wraps `@smartspectra/node-sdk`, exposes `POST /capture` and `GET /status`
- `faceAsymmetry.js` — geometry math for the facial asymmetry score (landmark-based, head-tilt corrected)

### `frontend-kiosk/src/`
- `screens/` — `Welcome`, `CheckInForm`, `RescanLookup`, `Capture`, `Message`
- `lib/` — `presage.js` (talks to `presage-agent`), `capture.js` (orchestrates real/mock/manual/elevated capture), `captureConfig.js`, `voice.js` + `useAnnouncer.js` (PA-style spoken prompts/announcements), `announcer.js`
- `components/` — `DemoControls`, `MuteToggle`, `AnnouncementBanner` [confirm exact list]

### `frontend-dashboard/src/`
- `components/` — `PatientCard`, `PatientList`
- `api/` — backend polling client

---

## Running it locally

Four processes, four terminals:

```bash
# 1. Backend
cd backend
cp ../.env.example .env   # fill in GEMINI_API_KEY (+ any voice/storage keys, see below)
npm install
npm run dev                 # http://localhost:4000

# 2. Presage capture agent — MUST run on the device with the camera
cd presage-agent
cp .env.example .env        # fill in PRESAGE_API_KEY
npm install
npm run dev                 # http://localhost:4600

# 3. Kiosk
cd frontend-kiosk
npm install
npm run dev                 # http://localhost:5173

# 4. Dashboard
cd frontend-dashboard
npm install
npm run dev                 # http://localhost:5174
```

**Demo mode / graceful fallback:** if `presage-agent` is unreachable, the kiosk automatically falls back to plausible mock vitals (`frontend-kiosk/src/lib/presage.js` → `mockVitals`/`elevatedVitals`) rather than failing the flow — useful if you're demoing without a working camera setup, or want a guaranteed elevated-HR "jumping jacks" moment on demand.

**Hidden demo controls** (in the kiosk UI): `D` arms elevated vitals for the next rescan, `M` opens manual vitals entry, `R` triggers an immediate recheck reminder. `Esc` closes any open panel.

**Resetting demo data:**
```bash
curl -X POST http://localhost:4000/admin/reset -H "Content-Type: application/json" -d '{"seed": true}'
```

---

## Environment variables

`.env.example` at the repo root and in `presage-agent/` show what's needed. At minimum:

| Variable | Where | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | `backend/.env` | Risk classification + alert text generation |
| `GEMINI_MODEL` | `backend/.env` | Defaults to a Gemini flash-tier model |
| `PRESAGE_API_KEY` | `presage-agent/.env` | Presage SmartSpectra SDK |
| `ELEVENLABS_API_KEY` | `backend/.env` | ElevenLabs text-to-speech for kiosk voice updates (check-in confirmations, rescan prompts, PA-style announcements) |
| *(object storage / backup creds)* | `backend/.env` [confirm] | If `dbBackup.js`/`objectStorage.js` push data off-instance |

*(Whoever owns `objectStorage.js` and `dbBackup.js` — please fill in the exact env var names here.)*

---

## API summary (backend, port 4000)

| Method | Path | Purpose |
|---|---|---|
| POST | `/checkin` | Create a patient |
| POST | `/reading` | Submit a vitals reading (baseline or rescan); triggers Gemini risk check on rescans |
| GET | `/patients` | List patients with latest reading + alert |
| GET | `/patients/:id/readings` | Full reading history |
| GET | `/alerts` | Active alerts, sorted by urgency |
| POST | `/alerts/:id/ack` | Acknowledge an alert |
| POST | `/admin/reset` | Wipe (and optionally seed) demo data |
| — | `/calls`, `/speak` | [confirm — voice/PA-related, not yet documented here] |

`presage-agent` (port 4600): `POST /capture` (run a vitals capture), `GET /status` (live framing hint + capture progress, polled by the kiosk UI during capture).

---

## Hosted on Vultr

The server (Terraform in `infra/`, Docker Compose + Caddy in `deploy/`) serves, over HTTPS:

| URL | What | Login |
|---|---|---|
| `https://dashboard.<server>` (and the original `https://<server>`) | Nurse dashboard | nurse login |
| `https://kiosk.<server>` | Hosted kiosk (production build) | kiosk **device** login (separate) |

Hostnames live only in the server's `.env` (`deploy/set-hosts.sh <root-host>`), so a custom domain is a config change. The hosted kiosk never contains the kiosk token; it calls `/api` on its own origin behind its device login and can only reach kiosk endpoints. The camera still comes from `presage-agent` on the laptop: add the hosted origin to `KIOSK_ORIGINS` in `presage-agent/.env` (see `presage-agent/.env.example`) -- otherwise the hosted kiosk falls back to demo mode. The laptop kiosk (`npm run dev`, `http://localhost:5173`) works exactly as before.

Redeploy: `scripts/deploy.ps1`. Request log: `scripts/logs.ps1`.

## Known limitations / honest caveats

- **Facial asymmetry is a screening cue, not a diagnosis.** It's explicitly framed that way in the Gemini prompt and should stay that way in any demo narration.
- **Breathing rate needs a stable, mounted camera** with the chest visible — handheld or poorly-framed setups will trigger validation warnings and may not produce a reading.
- Asymmetry alert thresholds (`ABSOLUTE_FLOOR` / `RELATIVE_MULTIPLIER` in `riskThresholds.js`) were calibrated against a small number of real test captures, not a clinical dataset.

---

## Sponsors / prize targets

- **Google Gemini API** — used in two distinct ways: structured JSON risk classification (baseline vs. current comparison across HR, breathing, asymmetry, EDA) and separate natural-language alert-text generation for the nurse dashboard.
- **Presage** — multi-signal fusion: heart rate, breathing rate, facial-asymmetry stroke screening, and EDA/stress — not just a single vital sign.
- **ElevenLabs** — natural, spoken voice updates at the kiosk (check-in confirmation, rescan prompts, PA-style announcements) via `backend/src/services/elevenLabsTts.js` and `frontend-kiosk/src/lib/voice.js` — no pre-recorded audio, no actors.
- **Vultr** — [confirm deployment details once `deploy/`/`infra/` are finalized]