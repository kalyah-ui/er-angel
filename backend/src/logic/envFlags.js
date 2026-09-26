/**
 * Feature flags like GEMINI_ENABLED / ELEVENLABS_ENABLED. "false", "0", "no"
 * or "off" (any case) disables; unset or anything else means enabled.
 * Read at call time so a restart picks up .env changes and tests can toggle.
 */
export function isFlagDisabled(name) {
  const value = (process.env[name] ?? "").trim().toLowerCase();
  return ["false", "0", "no", "off"].includes(value);
}
