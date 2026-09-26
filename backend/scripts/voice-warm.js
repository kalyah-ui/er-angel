/**
 * Pre-generates the kiosk's fixed voice lines -- screen prompts plus PA
 * announcements (triage calls, recheck reminders) for patients 1-10 -- so the
 * demo never waits on ElevenLabs. Lines already cached cost nothing.
 *
 *   npm run voice:warm                     # local: backend/data/voice-cache/ (+ bucket if S3_* is set)
 *   npm run voice:warm -- --hosted         # the hosted server: fills its disk cache + Object Storage bucket
 *   npm run voice:warm -- --patients=4-10  # also "You're checked in, patient number N" for N=4..10
 *
 * --hosted sends each line to the server's POST /speak, using VITE_API_URL
 * and VITE_KIOSK_TOKEN from frontend-kiosk/.env.local -- this laptop needs no
 * storage or ElevenLabs keys. Local mode uses ELEVENLABS_* from backend/.env.
 *
 * The lines come from frontend-kiosk/src/lib/voiceLines.js -- the same file
 * the kiosk speaks from -- so they can't drift apart. (After "Reset demo"
 * the next kiosk check-in is patient 4.)
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PROMPTS, FIXED_PROMPTS, ANNOUNCEMENTS } from "../../frontend-kiosk/src/lib/voiceLines.js";
import { synthesizeWithSource, voiceDisabledReason, VOICE_ID, MODEL_ID } from "../src/services/elevenLabsTts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KIOSK_ENV = path.join(__dirname, "../../frontend-kiosk/.env.local");

const ANNOUNCED_PATIENTS = Array.from({ length: 10 }, (_, i) => i + 1);

function patientRange(args) {
  const arg = args.find((a) => a.startsWith("--patients="));
  if (!arg) return [];
  const match = arg.slice("--patients=".length).match(/^(\d+)(?:-(\d+))?$/);
  if (!match) throw new Error(`--patients expects N or N-M, got "${arg}"`);
  const from = Number(match[1]);
  const to = Number(match[2] ?? match[1]);
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}

function readKioskEnv() {
  if (!fs.existsSync(KIOSK_ENV)) throw new Error(`--hosted needs ${KIOSK_ENV} (VITE_API_URL, VITE_KIOSK_TOKEN)`);
  const env = Object.fromEntries(
    fs.readFileSync(KIOSK_ENV, "utf8").split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]])
  );
  if (!env.VITE_API_URL || !env.VITE_KIOSK_TOKEN) throw new Error(`${KIOSK_ENV} must set VITE_API_URL and VITE_KIOSK_TOKEN`);
  return { apiUrl: env.VITE_API_URL.replace(/\/$/, ""), token: env.VITE_KIOSK_TOKEN };
}

// Returns the X-Voice-Source the server reports: memory|disk|bucket|elevenlabs.
async function speakOnServer({ apiUrl, token }, text) {
  const res = await fetch(`${apiUrl}/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kiosk-Token": token },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    let reason = "";
    try {
      reason = (await res.json()).reason ?? "";
    } catch {
      // non-JSON error (e.g. 401 from Caddy)
    }
    throw new Error(`server /speak HTTP ${res.status}${reason ? `: ${reason}` : ""}`);
  }
  await res.arrayBuffer();
  return res.headers.get("x-voice-source") ?? "unknown";
}

const args = process.argv.slice(2);
const hosted = args.includes("--hosted");
let target;
try {
  target = hosted ? readKioskEnv() : null;
} catch (err) {
  console.error(`[voice:warm] ${err.message}`);
  process.exit(1);
}

const disabled = hosted ? null : voiceDisabledReason();
if (disabled) {
  console.error(`[voice:warm] can't generate audio: ${disabled}. Set ELEVENLABS_ENABLED=true and ELEVENLABS_API_KEY in backend/.env.`);
  process.exit(1);
}

let patientIds;
try {
  patientIds = patientRange(args);
} catch (err) {
  console.error(`[voice:warm] ${err.message}`);
  process.exit(1);
}

const lines = [
  ...FIXED_PROMPTS.map((name) => ({ name, text: PROMPTS[name]() })),
  ...Object.entries(ANNOUNCEMENTS).flatMap(([type, lines]) =>
    ANNOUNCED_PATIENTS.map((n) => ({ name: `${type} #${n}`, text: lines.spoken(n) }))
  ),
  ...patientIds.map((id) => ({
    name: `checkedIn #${id}`,
    text: PROMPTS.checkedIn({ patient: { id } }),
  })),
];

console.log(
  `[voice:warm] ${hosted ? `hosted: ${target.apiUrl}` : "local"} -- voice ${VOICE_ID}, model ${MODEL_ID}, ${lines.length} lines`
);
let generatedChars = 0;
let failures = 0;
// One at a time: free-tier ElevenLabs limits concurrent requests.
for (const { name, text } of lines) {
  try {
    const source = hosted ? await speakOnServer(target, text) : (await synthesizeWithSource(text)).source;
    if (source === "elevenlabs") generatedChars += text.length;
    console.log(`  ${source.padEnd(10)} ${name.padEnd(14)} "${text}"`);
  } catch (err) {
    failures++;
    console.log(`  FAILED     ${name.padEnd(14)} ${err.message}`);
  }
}

console.log(`[voice:warm] done: ${generatedChars} ElevenLabs characters used, ${failures} failed`);
process.exit(failures ? 1 : 0);
