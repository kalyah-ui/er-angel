import test, { before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { allowedKioskOrigins, localAccess } from "../src/localAccess.js";

const HOSTED = "https://kiosk.149-248-60-145.sslip.io";
let server;
let base;
let handled = 0;

before(async () => {
  const guard = localAccess(allowedKioskOrigins(HOSTED));
  server = http.createServer((req, res) =>
    guard(req, res, () => {
      handled++;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    })
  );
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("allowed origins: localhost:5173 always, plus KIOSK_ORIGINS", () => {
  assert.deepStrictEqual(allowedKioskOrigins(undefined), ["http://localhost:5173"]);
  assert.deepStrictEqual(allowedKioskOrigins(` ${HOSTED}/ , https://kiosk.example.com`), [
    "http://localhost:5173",
    HOSTED,
    "https://kiosk.example.com",
  ]);
});

test("the local kiosk keeps working exactly as before", async () => {
  const res = await fetch(`${base}/health`, { headers: { Origin: "http://localhost:5173" } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get("access-control-allow-origin"), "http://localhost:5173");
});

test("hosted kiosk preflight gets CORS + Private Network Access headers", async () => {
  const res = await fetch(`${base}/capture`, {
    method: "OPTIONS",
    headers: {
      Origin: HOSTED,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
      "Access-Control-Request-Private-Network": "true",
    },
  });
  assert.strictEqual(res.status, 204);
  assert.strictEqual(res.headers.get("access-control-allow-origin"), HOSTED);
  assert.strictEqual(res.headers.get("access-control-allow-private-network"), "true");
  assert.match(res.headers.get("access-control-allow-methods"), /POST/);
  assert.strictEqual(res.headers.get("access-control-allow-headers"), "content-type");
});

test("any other website is refused (can't start or cancel captures)", async () => {
  const before = handled;
  for (const [method, path] of [["GET", "/health"], ["POST", "/cancel"], ["OPTIONS", "/capture"]]) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Origin: "https://evil.example", "Access-Control-Request-Private-Network": "true" },
    });
    assert.strictEqual(res.status, 403, `${method} ${path}`);
    assert.strictEqual(res.headers.get("access-control-allow-origin"), null);
    assert.strictEqual(res.headers.get("access-control-allow-private-network"), null);
  }
  assert.strictEqual(handled, before, "no request reached the agent's handlers");
});

test("requests without an Origin (curl, scripts) are unaffected", async () => {
  assert.strictEqual((await fetch(`${base}/health`)).status, 200);
});
