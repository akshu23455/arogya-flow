import { env } from "cloudflare:workers";
import { requireRole } from "@/lib/auth";

export async function POST(request: Request) {
  const session = await requireRole(request, ["admin"]);
  if (session instanceof Response) return session;
  const input = await request.json() as { doctorId?: string; leaveDate?: string; reason?: string };
  if (!input.doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(input.leaveDate ?? "")) return Response.json({ error: "doctorId and leaveDate are required" }, { status: 400 });
  const leaveId = crypto.randomUUID();
  try {
    const results = await env.DB.batch([
      env.DB.prepare("INSERT INTO doctor_leaves (id, doctor_id, leave_date, reason) VALUES (?, ?, ?, ?)").bind(leaveId, input.doctorId, input.leaveDate, input.reason?.trim() || "Unavailable"),
      env.DB.prepare("UPDATE appointments SET status = 'leave_conflict', updated_at = CURRENT_TIMESTAMP WHERE doctor_id = ? AND local_date = ? AND status = 'scheduled'").bind(input.doctorId, input.leaveDate),
      env.DB.prepare(`
        INSERT OR IGNORE INTO notification_jobs (id, idempotency_key, appointment_id, kind, channel, recipient, payload_json)
        SELECT lower(hex(randomblob(16))), 'leave:' || a.id || ':patient', a.id, 'cancellation', 'email', u.email,
          json_object('appointmentId', a.id, 'reason', 'doctor_leave', 'rebookingRequired', 1)
        FROM appointments a JOIN users u ON u.id = a.patient_id
        WHERE a.doctor_id = ? AND a.local_date = ? AND a.status = 'leave_conflict'
      `).bind(input.doctorId, input.leaveDate),
      env.DB.prepare(`
        INSERT OR IGNORE INTO notification_jobs (id, idempotency_key, appointment_id, kind, channel, recipient, payload_json)
        SELECT lower(hex(randomblob(16))), 'leave-calendar:' || a.id || ':patient', a.id, 'calendar', 'calendar', a.patient_id,
          json_object('appointmentId', a.id, 'audience', 'patient', 'operation', 'delete')
        FROM appointments a WHERE a.doctor_id = ? AND a.local_date = ? AND a.status = 'leave_conflict'
      `).bind(input.doctorId, input.leaveDate),
      env.DB.prepare(`
        INSERT OR IGNORE INTO notification_jobs (id, idempotency_key, appointment_id, kind, channel, recipient, payload_json)
        SELECT lower(hex(randomblob(16))), 'leave-calendar:' || a.id || ':doctor', a.id, 'calendar', 'calendar', d.user_id,
          json_object('appointmentId', a.id, 'audience', 'doctor', 'operation', 'delete')
        FROM appointments a JOIN doctor_profiles d ON d.id = a.doctor_id
        WHERE a.doctor_id = ? AND a.local_date = ? AND a.status = 'leave_conflict'
      `).bind(input.doctorId, input.leaveDate),
      env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, 'doctor.leave.created', 'doctor_leave', ?, json_object('doctorId', ?, 'leaveDate', ?))").bind(crypto.randomUUID(), session.sub, leaveId, input.doctorId, input.leaveDate),
    ]);
    return Response.json({ leave: { id: leaveId, doctorId: input.doctorId, leaveDate: input.leaveDate }, affectedAppointments: results[1].meta.changes ?? 0, notificationsQueued: (results[2].meta.changes ?? 0) + (results[3].meta.changes ?? 0) + (results[4].meta.changes ?? 0) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) return Response.json({ error: "Leave is already recorded for this date" }, { status: 409 });
    return Response.json({ error: "Leave could not be recorded" }, { status: 503 });
  }
}
