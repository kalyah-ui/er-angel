/**
 * Pre-generates the kiosk's fixed voice lines into backend/data/voice-cache/
 * so the demo never waits on ElevenLabs. Lines already cached cost nothing.
 * Doesn't need the backend running; uses ELEVENLABS_* from backend/.env.
 *
 *   npm run voice:warm                     # fixed lines only
 *   npm run voice:warm -- --patients=4-10  # also "You're checked in, patient number N" for N=4..10
 *
 * The lines come from frontend-kiosk/src/lib/voiceLines.js -- the same file
 * the kiosk speaks from -- so they can't drift apart. (After "Reset demo"
 * the next kiosk check-in is patient 4.)
 */
import "dotenv/config";
import { PROMPTS, FIXED_PROMPTS } from "../../frontend-kiosk/src/lib/voiceLines.js";
import { isCachedOnDisk, synthesize, voiceDisabledReason, VOICE_ID, MODEL_ID } from "../src/services/elevenLabsTts.js";

function patientRange(args) {
  const arg = args.find((a) => a.startsWith("--patients="));
  if (!arg) return [];
  const match = arg.slice("--patients=".length).match(/^(\d+)(?:-(\d+))?$/);
  if (!match) throw new Error(`--patients expects N or N-M, got "${arg}"`);
  const from = Number(match[1]);
  const to = Number(match[2] ?? match[1]);
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}

const disabled = voiceDisabledReason();
if (disabled) {
  console.error(`[voice:warm] can't generate audio: ${disabled}. Set ELEVENLABS_ENABLED=true and ELEVENLABS_API_KEY in backend/.env.`);
  process.exit(1);
}

let patientIds;
try {
  patientIds = patientRange(process.argv.slice(2));
} catch (err) {
  console.error(`[voice:warm] ${err.message}`);
  process.exit(1);
}

const lines = [
  ...FIXED_PROMPTS.map((name) => ({ name, text: PROMPTS[name]() })),
  ...patientIds.map((id) => ({
    name: `checkedIn #${id}`,
    text: PROMPTS.checkedIn({ patient: { id } }),
  })),
];

console.log(`[voice:warm] voice ${VOICE_ID}, model ${MODEL_ID}, ${lines.length} lines`);
let generatedChars = 0;
let failures = 0;
// One at a time: free-tier ElevenLabs limits concurrent requests.
for (const { name, text } of lines) {
  const wasCached = isCachedOnDisk(text);
  try {
    await synthesize(text);
    if (!wasCached) generatedChars += text.length;
    console.log(`  ${wasCached ? "cached   " : "generated"}  ${name.padEnd(14)} "${text}"`);
  } catch (err) {
    failures++;
    console.log(`  FAILED     ${name.padEnd(14)} ${err.message}`);
  }
}

console.log(`[voice:warm] done: ${generatedChars} ElevenLabs characters used, ${failures} failed`);
process.exit(failures ? 1 : 0);
