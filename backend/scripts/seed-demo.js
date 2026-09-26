/**
 * Resets the running backend and loads the demo patients -- the same thing
 * the dashboard's "Reset demo" button does (POST /admin/reset { seed: true }).
 * The demo data itself lives in src/logic/demoSeed.js.
 *
 *   npm run seed              # backend must already be running
 *   API_URL=http://host:4000 npm run seed
 */
const API_URL = process.env.API_URL || "http://localhost:4000";

const res = await fetch(`${API_URL}/admin/reset`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ seed: true }),
});
if (!res.ok) throw new Error(`POST /admin/reset -> ${res.status} ${await res.text()}`);

console.log(`Seeded ${API_URL}`);
for (const p of (await res.json()).patients) {
  console.log(`  ${p.name}: ${p.risk_level ? `${p.risk_level} -- ${p.reason_text}` : "baseline only"}`);
}
