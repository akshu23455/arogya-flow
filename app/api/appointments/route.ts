import { env } from "cloudflare:workers";
import { requireRole } from "@/lib/auth";

export async function POST(request: Request) {
  const session = await requireRole(request, ["patient"]);
  if (session instanceof Response) return session;
  const input = await request.json() as { holdId?: string; symptoms?: string };
  const symptoms = input.symptoms?.trim() ?? "";
  if (!input.holdId || symptoms.length < 10 || symptoms.length > 4000) return Response.json({ error: "A valid hold and symptom description are required" }, { status: 400 });
  const appointmentId = crypto.randomUUID();
  const intakeId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO appointments (id, doctor_id, patient_id, hold_id, starts_at, ends_at, local_date, status)
        SELECT ?, doctor_id, patient_id, id, starts_at, ends_at, local_date, 'scheduled'
        FROM slot_holds
        WHERE id = ? AND patient_id = ? AND status = 'active' AND expires_at > ?
          AND NOT EXISTS (SELECT 1 FROM doctor_leaves WHERE doctor_id = slot_holds.doctor_id AND leave_date = slot_holds.local_date)
      `).bind(appointmentId, input.holdId, session.sub, now),
      env.DB.prepare("UPDATE slot_holds SET status = 'consumed' WHERE id = ? AND patient_id = ? AND status = 'active'").bind(input.holdId, session.sub),
      env.DB.prepare(`
        INSERT INTO symptom_intakes (id, appointment_id, raw_symptoms, urgency, ai_status)
        SELECT ?, ?, ?, 'Unknown', 'fallback' WHERE EXISTS (SELECT 1 FROM appointments WHERE id = ?)
      `).bind(intakeId, appointmentId, symptoms, appointmentId),
      env.DB.prepare(`
        INSERT INTO notification_jobs (id, idempotency_key, appointment_id, kind, channel, recipient, payload_json)
        SELECT ?, ?, a.id, 'booking', 'email', u.email, json_object('appointmentId', a.id, 'audience', 'patient')
        FROM appointments a JOIN users u ON u.id = a.patient_id WHERE a.id = ?
      `).bind(crypto.randomUUID(), `booking:${appointmentId}:patient`, appointmentId),
      env.DB.prepare(`
        INSERT INTO notification_jobs (id, idempotency_key, appointment_id, kind, channel, recipient, payload_json)
        SELECT ?, ?, a.id, 'booking', 'email', u.email, json_object('appointmentId', a.id, 'audience', 'doctor')
        FROM appointments a JOIN doctor_profiles d ON d.id = a.doctor_id JOIN users u ON u.id = d.user_id WHERE a.id = ?
      `).bind(crypto.randomUUID(), `booking:${appointmentId}:doctor`, appointmentId),
      env.DB.prepare(`
        INSERT INTO notification_jobs (id, idempotency_key, appointment_id, kind, channel, recipient, payload_json)
        SELECT ?, ?, a.id, 'calendar', 'calendar', a.patient_id, json_object('appointmentId', a.id, 'audience', 'patient', 'operation', 'upsert')
        FROM appointments a WHERE a.id = ?
      `).bind(crypto.randomUUID(), `calendar:create:${appointmentId}:patient`, appointmentId),
      env.DB.prepare(`
        INSERT INTO notification_jobs (id, idempotency_key, appointment_id, kind, channel, recipient, payload_json)
        SELECT ?, ?, a.id, 'calendar', 'calendar', d.user_id, json_object('appointmentId', a.id, 'audience', 'doctor', 'operation', 'upsert')
        FROM appointments a JOIN doctor_profiles d ON d.id = a.doctor_id WHERE a.id = ?
      `).bind(crypto.randomUUID(), `calendar:create:${appointmentId}:doctor`, appointmentId),
      env.DB.prepare(`
        INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json)
        SELECT ?, ?, 'appointment.created', 'appointment', ?, json_object('holdId', ?) WHERE EXISTS (SELECT 1 FROM appointments WHERE id = ?)
      `).bind(crypto.randomUUID(), session.sub, appointmentId, input.holdId, appointmentId),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) return Response.json({ error: "The hold expired or the slot became unavailable" }, { status: 409 });
    return Response.json({ appointment: { id: appointmentId, status: "scheduled" }, aiSummary: { status: "queued", fallbackSafe: true }, notifications: { status: "queued" } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE") || message.includes("constraint")) return Response.json({ error: "This slot was just booked by someone else" }, { status: 409 });
    return Response.json({ error: "Booking could not be completed; your slot was not charged or confirmed" }, { status: 503 });
  }
}

export async function GET(request: Request) {
  const session = await requireRole(request, ["patient", "doctor", "admin"]);
  if (session instanceof Response) return session;
  const query = session.role === "patient"
    ? env.DB.prepare("SELECT * FROM appointments WHERE patient_id = ? ORDER BY starts_at DESC LIMIT 50").bind(session.sub)
    : session.role === "doctor"
      ? env.DB.prepare("SELECT a.* FROM appointments a JOIN doctor_profiles d ON d.id = a.doctor_id WHERE d.user_id = ? ORDER BY a.starts_at DESC LIMIT 50").bind(session.sub)
      : env.DB.prepare("SELECT * FROM appointments ORDER BY starts_at DESC LIMIT 100");
  const result = await query.all();
  return Response.json({ appointments: result.results });
}
