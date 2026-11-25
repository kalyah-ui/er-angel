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
│                    │──▶ S3-compatible storage (optional; off in production)
└────────┬───────────┘
         │ polls
         ▼
┌──────────────────┐
│  Nurse Dashboard   │
│  (React)           │
└────────────────────┘
```

**Why `presage-agent` is a separate process:** Presage's SmartSpectra SDK is native/Node, not a browser package — it needs direct OS-level camera access, which a browser tab can't grant to arbitrary code. So `presage-agent` runs as its own local process on the kiosk device itself (next to the physical webcam), and the kiosk browser calls its local HTTP API (`localhost:4600`) to get a reading, then forwards those numbers to the main backend exactly like any other reading. The main backend, dashboard, and database can live anywhere (currently a Google Cloud VM); only `presage-agent` is tied to the kiosk hardware.

---

## What it measures

| Signal | Source | Notes |
|---|---|---|
| Heart rate | Presage `cardioMetrics` | rPPG, contactless |
| Breathing rate | Presage `breathingMetrics` | needs chest visible in frame, camera should be stable/mounted |
| Facial asymmetry (stroke screening) | Presage `faceMetrics` landmarks + custom geometry (`presage-agent/src/faceAsymmetry.js`) | Inspired by the "F" in FAST (Face, Arms, Speech, Time). Compared **relative to that patient's own baseline**, not an absolute threshold — everyone has natural asymmetry. **Not a diagnosis** — a supplementary signal for a nurse to look at. |
| EDA / stress score | Presage `edaMetrics` | Electrodermal activity; field shape confirmed via live diagnostic logging in `presage-agent`. |

Every reading after the first is compared to that patient's **triage baseline**, not to a population norm. Comparison and risk scoring happen in `backend/src/services/geminiRisk.js` (primary path) with a rule-based fallback in `backend/src/logic/riskThresholds.js` if Gemini is unavailable — both use the same thresholds so alert behavior is consistent either way.

---

## Voice (ElevenLabs)

The kiosk speaks to the patient — check-in confirmation, rescan instructions, PA-style announcements — using ElevenLabs text-to-speech instead of static pre-recorded clips, so prompts can be dynamic (e.g. referencing the patient's own check-in number) without needing an actor or a recording session.

- `backend/src/services/elevenLabsTts.js` — generates speech audio from text via the ElevenLabs API
- `frontend-kiosk/src/lib/voice.js` + `useAnnouncer.js` — plays prompts on the kiosk, one line per screen, and surfaces PA-style announcements (e.g. recheck reminders) via `AnnouncementBanner`
- A mute toggle (`MuteToggle` component) is available in the kiosk UI

---

## Project layout

```
er-angel/
├── backend/              Express API, SQLite, Gemini integration, risk logic
├── presage-agent/        Local capture agent — MUST run on the kiosk device with the camera
├── frontend-kiosk/        Patient-facing check-in / rescan flow (browser)
├── frontend-dashboard/   Nurse-facing alert dashboard (browser)
├── docs/                 Architecture notes, demo script
├── deploy/               Server config + scripts: Caddyfile, web image, init-env/set-hosts/deploy scripts
├── infra/                Old Vultr Terraform (history only, see "Hosting & deployment")
├── scripts/              Laptop-side PowerShell: deploy.ps1, logs.ps1
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
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (+ optional `S3_REGION`, `BACKUP_HOUR_UTC`) | `backend/.env` / server `.env` | Optional S3-compatible bucket for the voice cache and nightly SQLite backups. Unset = off (the default, and how production runs) |

The server's full list, with which values are secrets, is in [.env.example](.env.example).

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

## Hosting & deployment

The server is a Google Compute Engine VM (e2-medium, Ubuntu 24.04, `northamerica-northeast1`, static IP `34.47.40.44`) running Docker Compose ([docker-compose.yml](docker-compose.yml)):

- **backend**: the Express API. SQLite and the voice cache live in the `backend-data` Docker volume on the VM's disk. It isn't published; only Caddy can reach it.
- **web**: Caddy ([deploy/Caddyfile](deploy/Caddyfile)) handles HTTPS (Let's Encrypt), the login, and the `/api` proxy. Its image ([deploy/web.Dockerfile](deploy/web.Dockerfile)) builds both frontends and serves them from `/srv/dashboard` and `/srv/kiosk`, so nothing is copied to the server by hand.

The project lives at `/opt/er-angel` (a git checkout of `main`), owned by the deploy user, with config in `/opt/er-angel/.env` (chmod 600, never in git). It serves, over HTTPS:

| URL | What | Login |
|---|---|---|
| `https://dashboard.erangel.health` (and `https://erangel.health`) | Nurse dashboard + `/api` | nurse login (Caddy basic auth); the laptop kiosk uses `X-Kiosk-Token` instead |
| `https://kiosk.erangel.health` | Hosted kiosk (production build) | none (public) |

Hostnames live only in the server's `.env` (`deploy/set-hosts.sh <root-host>`), so changing the domain is a config change. All three need DNS A records pointing at the server. The hosted kiosk never contains the kiosk token; it calls `/api` on its own origin. Because it's public, it has guardrails:

- Only kiosk endpoints are reachable (exact list in `deploy/Caddyfile`); the patient list, alerts, nurse calls and `/admin/reset` return 403.
- Per-IP rate limits on its API traffic, e.g. 5 check-ins/min (`backend/src/logic/rateLimit.js`).
- `/speak` only says the kiosk's own lines (`backend/src/logic/voiceLines.js`), for real patient numbers, so it can't be used to spend ElevenLabs credits.
- At most `GEMINI_MAX_CALLS_PER_HOUR` Gemini requests per hour (default 60); beyond that, alerts are rule-based.
 The camera still comes from `presage-agent` on the laptop: add the hosted origin to `KIOSK_ORIGINS` in `presage-agent/.env` (see `presage-agent/.env.example`) -- otherwise the hosted kiosk falls back to demo mode. The laptop kiosk (`npm run dev`, `http://localhost:5173`) works exactly as before.

### Setting up a new server

Prerequisites (done in the cloud console): ports 80/443 open, Docker installed (`curl -fsSL https://get.docker.com | sudo sh`), the deploy user in the `docker` group, 2 GB swap, and `/opt/er-angel` owned by the deploy user. Nothing depends on Terraform or cloud-init.

```bash
ssh -i ~/.ssh/er-angel-gcp salma@34.47.40.44
git clone https://github.com/kalyah-ui/er-angel.git /opt/er-angel
cd /opt/er-angel
bash deploy/init-env.sh 34-47-40-44.sslip.io   # creates .env: fresh KIOSK_TOKEN, hidden prompts for
                                               # Gemini/ElevenLabs keys and the dashboard password
bash deploy/remote-deploy.sh                   # builds, starts, waits for /api/health on all hosts
```

`init-env.sh` refuses to overwrite an existing `.env` and never prints a value. To change one setting later: `deploy/set-hosts.sh`, `deploy/set-dashboard-password.sh`, or edit `.env` on the server and redeploy (a plain `docker compose restart` does not re-read `.env`; `docker compose up -d` does).

If the build runs out of memory (unlikely: better-sqlite3 uses a prebuilt binary), build the two images on a laptop, push them to Artifact Registry, and add `image:` lines to `docker-compose.yml`.

### Testing before DNS moves

On the temporary `34-47-40-44.sslip.io` hostnames (sslip.io resolves them to the IP, so no DNS is needed):

1. `curl -s https://34-47-40-44.sslip.io/api/health`, plus the same for the `dashboard.` and `kiosk.` subdomains: each returns `{"ok":true}`. If not, `docker compose logs web --tail 30` shows certificate errors.
2. `https://dashboard.34-47-40-44.sslip.io` asks for the nurse login, then shows the patients. If it's empty, load the demo patients with the dashboard's "Reset demo" button or `docker compose exec -T backend node scripts/seed-demo.js` (both wipe existing data first).
3. Hosted kiosk: on `https://kiosk.34-47-40-44.sslip.io`, check in a patient, then rescan them (`D` arms elevated vitals). An alert appears on the dashboard.
4. Laptop kiosk: in `frontend-kiosk/.env.local`, set `VITE_API_URL=https://dashboard.34-47-40-44.sslip.io/api` and `VITE_KIOSK_TOKEN` (read it on the server: `grep ^KIOSK_TOKEN= /opt/er-angel/.env`), then `npm run dev` and repeat step 3.
5. `https://kiosk.34-47-40-44.sslip.io/api/patients` returns 403, and the dashboard without a login returns 401.

### DNS cutover

In Porkbun, point the A records for `erangel.health`, `dashboard.erangel.health` and `kiosk.erangel.health` at the server. Once they resolve, on the server run `bash deploy/set-hosts.sh erangel.health && bash deploy/remote-deploy.sh`. Update the laptop kiosk's `VITE_API_URL` to `https://dashboard.erangel.health/api`, and set presage-agent's `KIOSK_ORIGINS=https://kiosk.erangel.health`.

### Redeploying

Every push to `main` deploys automatically ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) over SSH with a deploy-only key that can run nothing but `deploy/remote-deploy.sh`. Setup, once:

1. `ssh-keygen -t ed25519 -f er-angel-deploy -C er-angel-deploy` (press Enter twice: CI needs it without a passphrase)
2. `Get-Content er-angel-deploy.pub | ssh -i ~/.ssh/er-angel-gcp salma@34.47.40.44 bash /opt/er-angel/deploy/authorize-ci-key.sh`
3. GitHub secrets: `DEPLOY_SSH_KEY` (the private key file), `DEPLOY_HOST=34.47.40.44`, `DEPLOY_USER=salma`, and `DEPLOY_KNOWN_HOSTS` (output of `ssh-keyscan -t ed25519 34.47.40.44`). Until all four are set, the workflow skips with a warning.

From a laptop, use `scripts/deploy.ps1` (redeploy) and `scripts/logs.ps1` (Caddy's redacted request log). They read the server, SSH user, key and public hostname from parameters or environment variables:

```powershell
$env:ER_ANGEL_SERVER = "34.47.40.44"; $env:ER_ANGEL_USER = "salma"
$env:ER_ANGEL_SSH_KEY = "$HOME\.ssh\er-angel-gcp"; $env:ER_ANGEL_SITE = "erangel.health"
.\scripts\deploy.ps1
```

### Backups

Bucket backups are **off** on this server: the `S3_*` variables are unset, so the backend logs `nightly backups off` and keeps the voice cache on disk only. The VM's disk is protected by scheduled GCP disk snapshots instead. The backup code (`backend/src/services/dbBackup.js`, `objectStorage.js`, `deploy/restore-db.sh`) still works with any S3-compatible bucket: set `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (optionally `S3_REGION`, `BACKUP_HOUR_UTC`) with `deploy/set-storage-env.sh`. Google Cloud Storage's S3 API lacks multi-object delete, which backup pruning uses, so that would need a small change first.

### History: Vultr

During the hackathon this ran on a Vultr VM provisioned by Terraform (`infra/`, with `infra/cloud-init.yaml`) and used Vultr Object Storage for backups. `infra/` is kept only to tear those resources down and isn't used by the current server.

## Known limitations / honest caveats

- **Facial asymmetry is a screening cue, not a diagnosis.** It's explicitly framed that way in the Gemini prompt.
- **Breathing rate needs a stable, mounted camera** with the chest visible — handheld or poorly-framed setups will trigger validation warnings and may not produce a reading.
- Asymmetry alert thresholds (`ABSOLUTE_FLOOR` / `RELATIVE_MULTIPLIER` in `riskThresholds.js`) were calibrated against a small number of real test captures, not a clinical dataset.

---

## Sponsors / prize targets

- **Google Gemini API** — used in two distinct ways: structured JSON risk classification (baseline vs. current comparison across HR, breathing, asymmetry, EDA) and separate natural-language alert-text generation for the nurse dashboard.
- **Presage** — multi-signal fusion: heart rate, breathing rate, facial-asymmetry stroke screening, and EDA/stress — not just a single vital sign.
- **ElevenLabs** — natural, spoken voice updates at the kiosk (check-in confirmation, rescan prompts, PA-style announcements) via `backend/src/services/elevenLabsTts.js` and `frontend-kiosk/src/lib/voice.js` — no pre-recorded audio, no actors.
- **Vultr** — infrastructure-as-code via Terraform (infra/), not a manually-clicked VM: a Vultr Compute instance provisioned from main.tf/variables.tf, bootstrapped on creation via cloud-init.yaml, with Caddy (deploy/Caddyfile) handling the reverse proxy and automatic HTTPS in front of the backend and dashboard. Backups/object storage are wired to Vultr Object Storage (infra/storage.tf, deploy/set-storage-env.sh, deploy/restore-db.sh), and deployment is scripted rather than manual (deploy/remote-deploy.sh, deploy/authorize-ci-key.sh).
