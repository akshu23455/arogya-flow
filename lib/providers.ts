import { env } from "cloudflare:workers";
import { decryptSecret } from "@/lib/secrets";

type Job = { id: string; channel: "email" | "calendar"; recipient: string; payload_json: string; appointment_id: string | null };
type Appointment = { id: string; starts_at: string; ends_at: string; patient_calendar_event_id: string | null; doctor_calendar_event_id: string | null; patient_email: string; patient_name: string; doctor_email: string; doctor_name: string; specialisation: string };
type CalendarConnection = { refresh_token_ciphertext: string; calendar_id: string };

function runtimeValue(name: string): string | undefined { const value = (env as unknown as Record<string, unknown>)[name]; return typeof value === "string" ? value : undefined; }
function escapeHtml(value: unknown): string { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

async function loadAppointment(id: string): Promise<Appointment> {
  const row = await env.DB.prepare(`
    SELECT a.id, a.starts_at, a.ends_at, a.patient_calendar_event_id, a.doctor_calendar_event_id,
      p.email patient_email, p.full_name patient_name, du.email doctor_email, du.full_name doctor_name, d.specialisation
    FROM appointments a JOIN users p ON p.id = a.patient_id JOIN doctor_profiles d ON d.id = a.doctor_id JOIN users du ON du.id = d.user_id
    WHERE a.id = ?
  `).bind(id).first<Appointment>();
  if (!row) throw new Error("Appointment no longer exists");
  return row;
}

async function sendEmail(job: Job, payload: Record<string, unknown>) {
  const apiKey = runtimeValue("RESEND_API_KEY");
  const from = runtimeValue("EMAIL_FROM");
  if (!apiKey || !from) {
    if (runtimeValue("DEMO_MODE") === "true") return;
    throw new Error("Email provider is not configured");
  }
  const appointment = job.appointment_id ? await loadAppointment(job.appointment_id) : null;
  const medication = typeof payload.medicine === "string" ? payload.medicine : null;
  const subject = medication ? `Medication reminder: ${medication}` : payload.reason === "doctor_leave" ? "Your appointment needs a new time" : "Your appointment is confirmed";
  const html = medication
    ? `<h2>Medication reminder</h2><p>It is time for <strong>${escapeHtml(medication)}</strong> (${escapeHtml(payload.dosage ?? "as prescribed")}).</p><p>Follow your doctor's instructions. If unsure, contact the clinic.</p>`
    : appointment ? `<h2>ArogyaFlow appointment update</h2><p>${escapeHtml(appointment.doctor_name)} · ${escapeHtml(new Date(appointment.starts_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))}</p><p>Open ArogyaFlow for details.</p>` : "<p>You have an ArogyaFlow update.</p>";
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": job.id }, body: JSON.stringify({ from, to: [job.recipient], subject, html }) });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
}

async function googleAccessToken(userId: string): Promise<{ token: string; calendarId: string }> {
  const connection = await env.DB.prepare("SELECT refresh_token_ciphertext, calendar_id FROM calendar_connections WHERE user_id = ?").bind(userId).first<CalendarConnection>();
  if (!connection) throw new Error("Google Calendar is not connected for this user");
  const body = new URLSearchParams({ client_id: runtimeValue("GOOGLE_CLIENT_ID") ?? "", client_secret: runtimeValue("GOOGLE_CLIENT_SECRET") ?? "", refresh_token: await decryptSecret(connection.refresh_token_ciphertext), grant_type: "refresh_token" });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!response.ok) throw new Error(`Google token refresh returned ${response.status}`);
  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error("Google token response did not contain an access token");
  return { token: data.access_token, calendarId: connection.calendar_id };
}

async function syncCalendar(job: Job, payload: Record<string, unknown>) {
  if (!job.appointment_id) throw new Error("Calendar job is missing appointmentId");
  const appointment = await loadAppointment(job.appointment_id);
  const audience = payload.audience === "doctor" ? "doctor" : "patient";
  const operation = payload.operation === "delete" ? "delete" : "upsert";
  const currentEventId = audience === "doctor" ? appointment.doctor_calendar_event_id : appointment.patient_calendar_event_id;
  const { token, calendarId } = await googleAccessToken(job.recipient);
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (operation === "delete") {
    if (!currentEventId) return;
    const response = await fetch(`${base}/${encodeURIComponent(currentEventId)}`, { method: "DELETE", headers });
    if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error(`Google Calendar delete returned ${response.status}`);
    return;
  }
  const event = { summary: `Appointment with ${audience === "doctor" ? appointment.patient_name : appointment.doctor_name}`, description: `${appointment.specialisation} appointment managed by ArogyaFlow`, start: { dateTime: appointment.starts_at }, end: { dateTime: appointment.ends_at }, reminders: { useDefault: false, overrides: [{ method: "email", minutes: 60 }] } };
  const response = await fetch(currentEventId ? `${base}/${encodeURIComponent(currentEventId)}` : base, { method: currentEventId ? "PUT" : "POST", headers, body: JSON.stringify(event) });
  if (!response.ok) throw new Error(`Google Calendar returned ${response.status}`);
  const saved = await response.json() as { id?: string };
  if (!currentEventId && saved.id) {
    const column = audience === "doctor" ? "doctor_calendar_event_id" : "patient_calendar_event_id";
    await env.DB.prepare(`UPDATE appointments SET ${column} = ? WHERE id = ?`).bind(saved.id, appointment.id).run();
  }
}

export async function dispatchJob(job: Job) {
  const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
  if (job.channel === "email") return sendEmail(job, payload);
  return syncCalendar(job, payload);
}
