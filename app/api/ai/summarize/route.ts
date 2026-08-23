import { env } from "cloudflare:workers";
import { createPostVisitSummary, createPreVisitSummary } from "@/lib/llm";
import { requireRole } from "@/lib/auth";

type AppointmentAccess = { id: string };

export async function POST(request: Request) {
  const session = await requireRole(request, ["patient", "doctor", "admin"]);
  if (session instanceof Response) return session;
  const input = await request.json() as { kind?: "previsit" | "postvisit"; appointmentId?: string; text?: string };
  const text = input.text?.trim() ?? "";
  if (!input.appointmentId || !input.kind || text.length < 10 || text.length > 8000) return Response.json({ error: "kind, appointmentId, and valid text are required" }, { status: 400 });
  if (input.kind === "postvisit" && session.role === "patient") return Response.json({ error: "Only a doctor may generate a post-visit summary" }, { status: 403 });
  const accessSql = session.role === "patient"
    ? "SELECT id FROM appointments WHERE id = ? AND patient_id = ?"
    : session.role === "doctor"
      ? "SELECT a.id FROM appointments a JOIN doctor_profiles d ON d.id = a.doctor_id WHERE a.id = ? AND d.user_id = ?"
      : "SELECT id FROM appointments WHERE id = ? AND ? IS NOT NULL";
  const appointment = await env.DB.prepare(accessSql).bind(input.appointmentId, session.sub).first<AppointmentAccess>();
  if (!appointment) return Response.json({ error: "Appointment not found" }, { status: 404 });
  if (input.kind === "previsit") {
    const summary = await createPreVisitSummary(text);
    await env.DB.prepare(`
      UPDATE symptom_intakes SET raw_symptoms = ?, urgency = ?, chief_complaint = ?, suggested_questions_json = ?, ai_status = ?
      WHERE appointment_id = ?
    `).bind(text, summary.urgency, summary.chiefComplaint, JSON.stringify(summary.suggestedQuestions), summary.aiStatus, input.appointmentId).run();
    return Response.json({ summary, disclaimer: "This organises patient-provided information and is not a diagnosis." });
  }
  const summary = await createPostVisitSummary(text);
  await env.DB.prepare(`
    INSERT INTO visit_notes (id, appointment_id, clinical_notes, prescription_json, patient_summary, ai_status)
    VALUES (?, ?, ?, '[]', ?, ?)
    ON CONFLICT(appointment_id) DO UPDATE SET clinical_notes = excluded.clinical_notes, patient_summary = excluded.patient_summary, ai_status = excluded.ai_status
  `).bind(crypto.randomUUID(), input.appointmentId, text, JSON.stringify(summary), summary.aiStatus).run();
  return Response.json({ summary, requiresDoctorApproval: true });
}
