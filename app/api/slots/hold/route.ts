import { env } from "cloudflare:workers";
import { requireRole } from "@/lib/auth";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  const session = await requireRole(request, ["patient"]);
  if (session instanceof Response) return session;
  const input = await request.json() as { doctorId?: string; startsAt?: string; endsAt?: string; localDate?: string };
  const startsAt = new Date(input.startsAt ?? "");
  const endsAt = new Date(input.endsAt ?? "");
  if (!input.doctorId || !ISO_DATE.test(input.localDate ?? "") || Number.isNaN(startsAt.valueOf()) || Number.isNaN(endsAt.valueOf()) || endsAt <= startsAt || endsAt.valueOf() - startsAt.valueOf() > 2 * 60 * 60 * 1000) {
    return Response.json({ error: "Invalid doctor, date, or slot" }, { status: 400 });
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  try {
    const [, insert] = await env.DB.batch([
      env.DB.prepare("UPDATE slot_holds SET status = 'expired' WHERE status = 'active' AND expires_at <= ?").bind(now),
      env.DB.prepare(`
        INSERT INTO slot_holds (id, doctor_id, patient_id, starts_at, ends_at, local_date, expires_at, status)
        SELECT ?, id, ?, ?, ?, ?, ?, 'active'
        FROM doctor_profiles
        WHERE id = ? AND active = 1
          AND NOT EXISTS (SELECT 1 FROM doctor_leaves WHERE doctor_id = ? AND leave_date = ?)
          AND NOT EXISTS (SELECT 1 FROM appointments WHERE doctor_id = ? AND starts_at = ? AND status = 'scheduled')
      `).bind(id, session.sub, startsAt.toISOString(), endsAt.toISOString(), input.localDate, expiresAt, input.doctorId, input.doctorId, input.localDate, input.doctorId, startsAt.toISOString()),
    ]);
    if ((insert.meta.changes ?? 0) !== 1) return Response.json({ error: "This slot is no longer available" }, { status: 409 });
    return Response.json({ hold: { id, doctorId: input.doctorId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), expiresAt } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE") || message.includes("constraint")) return Response.json({ error: "Another patient is holding this slot" }, { status: 409 });
    return Response.json({ error: "Unable to hold the slot right now" }, { status: 503 });
  }
}
