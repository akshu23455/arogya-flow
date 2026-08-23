import { env } from "cloudflare:workers";
import { requireRole } from "@/lib/auth";
import { createPostVisitSummary } from "@/lib/llm";

type Medication = { name?: string; dosage?: string; frequency?: string; times?: string[]; startDate?: string; endDate?: string };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireRole(request, ["doctor"]);
  if (session instanceof Response) return session;
  const { id: appointmentId } = await context.params;
  const input = await request.json() as { clinicalNotes?: string; medications?: Medication[]; approveSummary?: boolean };
  const notes = input.clinicalNotes?.trim() ?? "";
  const medications = (input.medications ?? []).filter((item) => item.name && item.dosage && item.frequency && item.startDate && item.endDate && item.times?.length);
  if (notes.length < 10 || notes.length > 10_000 || medications.length > 12) return Response.json({ error: "Valid clinical notes and at most 12 medications are required" }, { status: 400 });
  const access = await env.DB.prepare("SELECT a.patient_id FROM appointments a JOIN doctor_profiles d ON d.id = a.doctor_id WHERE a.id = ? AND d.user_id = ? AND a.status = 'scheduled'").bind(appointmentId, session.sub).first<{ patient_id: string }>();
  if (!access) return Response.json({ error: "Scheduled appointment not found" }, { status: 404 });
  const summary = await createPostVisitSummary(notes);
  const statements = [
    env.DB.prepare(`
      INSERT INTO visit_notes (id, appointment_id, clinical_notes, prescription_json, patient_summary, ai_status, approved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(appointment_id) DO UPDATE SET clinical_notes = excluded.clinical_notes, prescription_json = excluded.prescription_json, patient_summary = excluded.patient_summary, ai_status = excluded.ai_status, approved_at = excluded.approved_at
    `).bind(crypto.randomUUID(), appointmentId, notes, JSON.stringify(medications), JSON.stringify(summary), summary.aiStatus, input.approveSummary ? new Date().toISOString() : null),
    env.DB.prepare("UPDATE appointments SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'scheduled'").bind(appointmentId),
    ...medications.map((medication) => env.DB.prepare(`
      INSERT INTO medication_schedules (id, appointment_id, patient_id, medicine_name, dosage, frequency, times_json, start_date, end_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), appointmentId, access.patient_id, medication.name, medication.dosage, medication.frequency, JSON.stringify(medication.times), medication.startDate, medication.endDate)),
    env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, 'visit.completed', 'appointment', ?, json_object('medications', ?, 'summaryApproved', ?))").bind(crypto.randomUUID(), session.sub, appointmentId, medications.length, input.approveSummary ? 1 : 0),
  ];
  await env.DB.batch(statements);
  return Response.json({ appointmentId, summary, summaryApproved: Boolean(input.approveSummary), medicationSchedulesCreated: medications.length });
}
