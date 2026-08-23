import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships the branded three-role product shell", async () => {
  const [layout, app] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/arogya-flow.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /ArogyaFlow \| Care that stays in sync/);
  assert.doesNotMatch(layout, /codex-preview|Starter Project/);
  assert.match(app, /Demo mode · sample patient data/);
  assert.match(app, /patient.*doctor.*admin/s);
  assert.match(app, /We’ll keep this time for/);
});

test("database migration contains the concurrency and reliability guards", async () => {
  const migration = await readFile(new URL("../drizzle/0000_supreme_omega_red.sql", import.meta.url), "utf8");
  assert.match(migration, /active_doctor_slot_hold_unique/);
  assert.match(migration, /doctor_appointment_slot_unique/);
  assert.match(migration, /notification_jobs/);
  assert.match(migration, /idempotency_key/);
});
