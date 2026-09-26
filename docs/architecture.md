# Architecture

```
[Kiosk Web App] --(camera)--> [Presage SDK] --vitals JSON--> [Backend API on Vultr]
        |                                                            |
   (check-in form)                                                   |
                                                                      v
                                                            [SQLite: patients, readings, alerts]
                                                                      |
                                                          every non-baseline reading triggers:
                                                                      v
                                                    [Gemini Call 1: baseline vs current -> risk JSON]
                                                                      |
                                                    [Gemini Call 2: risk JSON -> nurse-facing line]
                                                                      |
                                                                      v
                                                    [Nurse Dashboard] <--polls every 5s-- [Backend]
```

## Why these choices
- **SQLite over Postgres initially**: zero setup time, migrate later only
  if there's slack (see schedule hour 18-20).
- **Polling over websockets**: invisible to judges, half the engineering
  risk of a hackathon weekend.
- **Two Gemini calls, not one**: structured JSON risk classification
  (function-calling/JSON-mode friendly) is separated from natural-language
  alert generation, so each call has one clear job and the JSON call stays
  reliably parseable.
- **Fallback logic for every Gemini call**: rule-based thresholds in
  `backend/src/logic/riskThresholds.js` kick in if the API times out or
  errors, so the demo never shows a blank state.
