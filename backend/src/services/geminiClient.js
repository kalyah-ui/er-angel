import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
// Previous Flash generation: separate capacity, so a demand spike on the
// primary model usually doesn't hit it too.
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.7-flash";

const REQUEST_TIMEOUT_MS = 8000;
const RETRY_DELAYS_MS = [1000, 2000]; // primary model: up to 2 retries

// Transient server-side failures worth retrying. Errors with no HTTP status
// are timeouts/network failures (or our own parse checks) -- also retryable.
// Anything else goes straight to the next model: 400 bad request, 403 key,
// 404 retired model, and 429 -- free-tier quota is per model *per day*, so a
// 1-2s backoff can't help, but the fallback model has its own quota.
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

function isRetryable(err) {
  return err.status == null || RETRYABLE_STATUS.has(err.status);
}

function shortError(err) {
  return err.status ? `${err.status} ${err.statusText || ""}`.trim() : err.message;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function hasGeminiKey() {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Runs `run(model)` against the primary Flash model, retrying transient
 * failures with backoff, then makes one attempt on the fallback Flash model.
 * Throws if every attempt fails -- callers use their rule-based fallback.
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

  let lastError;
  for (const { model: modelName, delays } of plan) {
    const model = genAI.getGenerativeModel(
      { ...modelParams, model: modelName },
      { timeout: REQUEST_TIMEOUT_MS }
    );

    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        const result = await run(model);
        if (modelName !== PRIMARY_MODEL || attempt > 0) {
          console.warn(`[${label}] succeeded on ${modelName} (attempt ${attempt + 1})`);
        }
        return result;
      } catch (err) {
        lastError = err;
        const retrying = attempt < delays.length && isRetryable(err);
        console.warn(
          `[${label}] ${modelName} attempt ${attempt + 1} failed: ${shortError(err)}` +
            (retrying ? ` -- retrying in ${delays[attempt]}ms` : "")
        );
        if (!retrying) break;
        await sleep(delays[attempt]);
      }
    }
  }

  throw lastError;
}
