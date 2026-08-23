import { env } from "cloudflare:workers";
import { readSession } from "@/lib/auth";

type Schedule = { id: string; appointment_id: string; patient_id: string; medicine_name: string; dosage: string; frequency: string; times_json: string; timezone: string; email: string };

async function authorised(request: Request): Promise<boolean> {
  const expected = (env as unknown as Record<string, unknown>).WORKER_SECRET;
  if (typeof expected === "string" && request.headers.get("authorization") === `Bearer ${expected}`) return true;
  return (await readSession(request))?.role === "admin";
}

export async function POST(request: Request) {
  if (!(await authorised(request))) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const input = await request.json().catch(() => ({})) as { localDate?: string };
  const localDate = /^\d{4}-\d{2}-\d{2}$/.test(input.localDate ?? "") ? input.localDate! : new Date().toISOString().slice(0, 10);
  const schedules = await env.DB.prepare(`
    SELECT m.id, m.appointment_id, m.patient_id, m.medicine_name, m.dosage, m.frequency, m.times_json, m.timezone, u.email
    FROM medication_schedules m JOIN users u ON u.id = m.patient_id
    WHERE m.active = 1 AND m.start_date <= ? AND m.end_date >= ?
  `).bind(localDate, localDate).all<Schedule>();
  const inserts = schedules.results.flatMap((schedule) => {
    let times: string[] = [];
    try { times = JSON.parse(schedule.times_json) as string[]; } catch { return []; }
    return times.filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)).map((time) => env.DB.prepare(`
      INSERT OR IGNORE INTO notification_jobs (id, idempotency_key, appointment_id, kind, channel, recipient, payload_json, next_attempt_at)
      VALUES (?, ?, ?, 'medication', 'email', ?, json_object('scheduleId', ?, 'medicine', ?, 'dosage', ?, 'scheduledLocalTime', ?, 'timezone', ?), ?)
    `).bind(crypto.randomUUID(), `med:${schedule.id}:${localDate}:${time}`, schedule.appointment_id, schedule.email, schedule.id, schedule.medicine_name, schedule.dosage, `${localDate}T${time}`, schedule.timezone, new Date(`${localDate}T${time}:00+05:30`).toISOString()));
  });
  if (!inserts.length) return Response.json({ schedulesChecked: schedules.results.length, remindersCreated: 0 });
  const results = await env.DB.batch(inserts);
  return Response.json({ schedulesChecked: schedules.results.length, remindersCreated: results.reduce((sum, item) => sum + (item.meta.changes ?? 0), 0) });
}
