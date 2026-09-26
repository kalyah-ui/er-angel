# ER Angel

ER waiting room guardian. A kiosk captures a contactless vitals baseline
(Presage) at check-in. Every rescan is compared against that baseline by
Gemini, which reasons about deterioration and pushes a plain-English,
prioritized alert to a nurse dashboard.

## Project layout

```
waitwatch/
├── backend/             Express API + SQLite + Gemini integration
├── frontend-kiosk/      Patient-facing check-in / rescan screen
├── frontend-dashboard/  Nurse-facing alert dashboard
└── docs/                Architecture notes + demo script
```

## Quick start (local dev)

Open three terminals:

```bash
# 1. Backend
cd backend
cp ../.env.example .env   # fill in GEMINI_API_KEY, PRESAGE_API_KEY
npm install
npm run dev                # http://localhost:4000

# 2. Kiosk
cd frontend-kiosk
npm install
npm run dev                # http://localhost:5173

# 3. Dashboard
cd frontend-dashboard
npm install
npm run dev                # http://localhost:5174
```

## Environment variables

See `.env.example`. Copy it to `backend/.env` and fill in real keys.

## API contract (agree on this before writing code)

| Method | Path                     | Purpose                                         |
|--------|--------------------------|--------------------------------------------------|
| POST   | `/checkin`               | Create a patient (name, chief_complaint)         |
| POST   | `/reading`                | Submit a vitals reading (baseline or rescan)     |
| GET    | `/patients`               | List patients with latest status                 |
| GET    | `/patients/:id/readings`  | Full reading history for one patient             |
| GET    | `/alerts`                 | List active alerts, sorted by urgency            |
| POST   | `/alerts/:id/ack`         | Nurse acknowledges an alert                      |

See `backend/src/db/schema.sql` for the exact data shapes.

## Deploying to Vultr

```bash
docker compose up --build -d
```

Point a Vultr Compute instance's DNS/IP at ports 4000 (backend), 5173
(kiosk), 5174 (dashboard), or put nginx in front of all three. Do this
deploy EARLY (see schedule) — don't leave it to the last few hours.

## Demo script

See `docs/demo-script.md`.
