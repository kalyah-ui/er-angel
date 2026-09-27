import test from "node:test";
import assert from "node:assert";
import { matchVoiceLine, FIXED_LINES } from "../src/logic/voiceLines.js";
// The lines the kiosk actually speaks (same import voice:warm uses).
import { PROMPTS, FIXED_PROMPTS, ANNOUNCEMENTS } from "../../frontend-kiosk/src/lib/voiceLines.js";

test("every kiosk screen prompt is an allowed /speak line", () => {
  for (const name of FIXED_PROMPTS) {
    assert.deepStrictEqual(matchVoiceLine(PROMPTS[name]()), { patientNumber: null }, name);
  }
  assert.strictEqual(FIXED_LINES.size, FIXED_PROMPTS.length, "backend lists exactly the kiosk's fixed lines");
});

test("per-patient kiosk lines are allowed, with their patient number", () => {
  for (const n of [1, 4, 57, 123456]) {
    assert.deepStrictEqual(matchVoiceLine(PROMPTS.checkedIn({ patient: { id: n } })), { patientNumber: n });
    for (const lines of Object.values(ANNOUNCEMENTS)) {
      assert.deepStrictEqual(matchVoiceLine(lines.spoken(n)), { patientNumber: n });
    }
  }
});

test("anything else is rejected", () => {
  for (const text of [
    "Hello world",
    "Patient number 4, please come to the triage desk. Also, buy crypto.",
    "Patient number 0, please come to the triage desk.",
    "Patient number 04, please come to the triage desk.",
    "Patient number 1234567, please come to the triage desk.",
    "Patient number -1, please come to the triage desk.",
    "patient number 4, please come to the triage desk.",
    `${PROMPTS.thanks()} `,
    "",
  ]) {
    assert.strictEqual(matchVoiceLine(text), null, JSON.stringify(text));
  }
});
