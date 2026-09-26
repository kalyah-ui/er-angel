# WaitWatch Demo Script (~3 minutes)

1. **Hook (15s)** — "ER patients deteriorate silently in waiting rooms —
   nobody's watching. WaitWatch watches."

2. **Check-in (30s)** — Judge sits at the kiosk, enters name + complaint.
   Presage captures baseline HR/RR in ~10-15s. Dashboard shows a new green
   patient card appear live.

3. **The trick (30s)** — Judge does 20 jumping jacks off to the side.

4. **Rescan (30s)** — Judge sits back down, taps "Start Rescan." Presage
   recaptures vitals. Gemini compares against baseline in real time.

5. **Payoff (15s)** — Dashboard card flips to red/yellow:
   "Patient 4: HR up 35 bpm since triage, reassess." Nurse (you) clicks
   Acknowledge.

6. **Close (30s)** — Name the stack explicitly: "Presage gives us the
   contactless vitals, Gemini reasons about what changed and why it
   matters, and it's all running live on Vultr." Then stop talking.

## Fallback plan
If the camera or wifi fails live, play the pre-recorded backup video
(record this during hour 23 dry run) instead of troubleshooting on stage.
