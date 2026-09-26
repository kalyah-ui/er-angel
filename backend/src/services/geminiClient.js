import { GoogleGenerativeAI } from "@google/generative-ai";

const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
// Previous Flash generation: separate capacity, so a demand spike on the
// primary model usually doesn't hit it too.
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.7-flash";

const REQUEST_TIMEOUT_MS = 8000;
const RETRY_DELAYS_MS = [1000, 2000]; // primary model: up to 2 retries

// Transient server-side failures worth retrying. Errors with no HTTP status
// are timeouts/network failures (or our own parse checks) -- also retryable.
// 429 is handled separately: free-tier quota is per project, per model, *per
// day*, so a 1-2s backoff can't help -- switch to the next key instead. Any
// other status (400 bad request, 403 key, 404 retired model) moves straight
// on to the next model.
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

function isRetryable(err) {
  return err.status == null || RETRYABLE_STATUS.has(err.status);
}

function shortError(err) {
  return err.status ? `${err.status} ${err.statusText || ""}`.trim() : err.message;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Read at call time so tests (and anything that tweaks process.env) see changes.
function apiKeys() {
  return [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].filter(Boolean);
}

/**
 * Why Gemini shouldn't be called right now, or null if it can be.
 * GEMINI_ENABLED=false (or 0/no/off) turns it off to save free-tier quota
 * during development; unset means enabled.
 */
export function geminiDisabledReason() {
  const flag = (process.env.GEMINI_ENABLED ?? "").trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(flag)) return "GEMINI_ENABLED=false";
  if (!apiKeys().length) return "no GEMINI_API_KEY set";
  return null;
}

/**
 * Runs `run(model)` against the primary Flash model, retrying transient
 * failures with backoff, then makes one attempt on the fallback Flash model.
 * On a 429 (quota), switches to GEMINI_API_KEY_2 for the same model, if set,
 * before moving on. Throws if every attempt fails -- callers use their
 * rule-based fallback.
 *
 * @param {string} label  log prefix, e.g. "geminiRisk"
 * @param {object} modelParams  getGenerativeModel params minus `model`
 * @param {(model) => Promise<any>} run  should throw on a bad/unparseable response
 */
export async function callGemini(label, modelParams, run) {
  const plan = [
    { model: PRIMARY_MODEL, delays: RETRY_DELAYS_MS },
    { model: FALLBACK_MODEL, delays: [] },
  ];
  const keys = apiKeys();

  let lastError;
  for (const { model: modelName, delays } of plan) {
    keyLoop: for (let k = 0; k < keys.length; k++) {
      const where = keys.length > 1 ? `${modelName} (key ${k + 1})` : modelName;
      const model = new GoogleGenerativeAI(keys[k]).getGenerativeModel(
        { ...modelParams, model: modelName },
        { timeout: REQUEST_TIMEOUT_MS }
      );

      for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
          const result = await run(model);
          if (modelName !== PRIMARY_MODEL || k > 0 || attempt > 0) {
            console.warn(`[${label}] succeeded on ${where} (attempt ${attempt + 1})`);
          }
          return result;
        } catch (err) {
          lastError = err;

          if (err.status === 429 && k < keys.length - 1) {
            console.warn(`[${label}] ${where} quota exceeded (429) -- switching to key ${k + 2}`);
            continue keyLoop;
          }

          const retrying = attempt < delays.length && isRetryable(err);
          console.warn(
            `[${label}] ${where} attempt ${attempt + 1} failed: ${shortError(err)}` +
              (retrying ? ` -- retrying in ${delays[attempt]}ms` : "")
          );
          if (!retrying) break keyLoop; // move on to the next model
          await sleep(delays[attempt]);
        }
      }
    }
  }

  throw lastError;
}
