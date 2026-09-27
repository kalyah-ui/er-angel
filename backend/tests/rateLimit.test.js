import test from "node:test";
import assert from "node:assert";
import { rateLimit, publicKioskLimits } from "../src/logic/rateLimit.js";

// Minimal req/res doubles; `run` reports "next" or the HTTP status sent.
function fakeReq({ ip = "1.2.3.4", method = "POST", path = "/checkin", publicKiosk = true } = {}) {
  const headers = publicKiosk ? { "x-er-angel-public": "kiosk" } : {};
  return { ip, method, path, get: (name) => headers[name.toLowerCase()] };
}
function run(middleware, req) {
  let outcome = "next";
  const res = {
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { outcome = code; return this; },
    json() { return this; },
  };
  middleware(req, res, () => {});
  return { outcome, res };
}

test("allows `max` requests per window per IP, then 429 with Retry-After", () => {
  let now = 0;
  const limit = rateLimit({ name: "t", max: 3, windowMs: 60_000, now: () => now });
  for (let i = 0; i < 3; i++) assert.strictEqual(run(limit, fakeReq()).outcome, "next");
  const blocked = run(limit, fakeReq());
  assert.strictEqual(blocked.outcome, 429);
  assert.strictEqual(blocked.res.headers["Retry-After"], "60");
  // Another IP has its own budget.
  assert.strictEqual(run(limit, fakeReq({ ip: "5.6.7.8" })).outcome, "next");
  // Next window: allowed again.
  now = 60_000;
  assert.strictEqual(run(limit, fakeReq()).outcome, "next");
});

test("public kiosk: 5 check-ins per minute per IP", () => {
  const limits = publicKioskLimits();
  for (let i = 0; i < 5; i++) assert.strictEqual(run(limits, fakeReq()).outcome, "next");
  assert.strictEqual(run(limits, fakeReq()).outcome, 429);
  // Other routes still work for that IP.
  assert.strictEqual(run(limits, fakeReq({ method: "GET", path: "/calls/pending" })).outcome, "next");
});

test("public kiosk: /speak and recheck have their own limits", () => {
  const limits = publicKioskLimits();
  for (let i = 0; i < 30; i++) assert.strictEqual(run(limits, fakeReq({ path: "/speak" })).outcome, "next");
  assert.strictEqual(run(limits, fakeReq({ path: "/speak" })).outcome, 429);
  for (let i = 0; i < 10; i++) assert.strictEqual(run(limits, fakeReq({ path: "/patients/4/recheck" })).outcome, "next");
  assert.strictEqual(run(limits, fakeReq({ path: "/patients/4/recheck" })).outcome, 429);
});

test("requests not marked as public kiosk (laptop kiosk, dashboard, local dev) aren't limited", () => {
  const limits = publicKioskLimits();
  for (let i = 0; i < 50; i++) {
    assert.strictEqual(run(limits, fakeReq({ publicKiosk: false })).outcome, "next");
  }
});
