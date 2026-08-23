import { env } from "cloudflare:workers";

export type PreVisitSummary = { urgency: "Low" | "Medium" | "High"; chiefComplaint: string; suggestedQuestions: string[]; aiStatus: "ready" | "fallback" };
export type PostVisitSummary = { summary: string; medicationSchedule: string[]; followUpSteps: string[]; aiStatus: "ready" | "fallback" };

const RED_FLAGS = ["chest pain", "chest tightness", "cannot breathe", "difficulty breathing", "fainted", "unconscious", "severe bleeding", "one-sided weakness"];

function clean(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function stringList(value: unknown): string[] { return Array.isArray(value) ? value.map(clean).filter(Boolean).slice(0, 5) : []; }

async function requestJson(system: string, prompt: string): Promise<Record<string, unknown> | null> {
  const runtime = env as unknown as Record<string, unknown>;
  const apiUrl = runtime.LLM_API_URL;
  const apiKey = runtime.LLM_API_KEY;
  const model = runtime.LLM_MODEL;
  if (typeof apiUrl !== "string" || typeof apiKey !== "string" || typeof model !== "string") return null;
  try {
    const response = await fetch(apiUrl, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }) });
    if (!response.ok) return null;
    const payload = await response.json() as { choices?: { message?: { content?: string } }[]; output_text?: string };
    const content = payload.choices?.[0]?.message?.content ?? payload.output_text;
    return content ? JSON.parse(content) as Record<string, unknown> : null;
  } catch { return null; }
}

export async function createPreVisitSummary(symptoms: string): Promise<PreVisitSummary> {
  const system = "You organise patient-provided symptoms for a licensed doctor. Do not diagnose or recommend treatment. Return JSON only with urgency (Low, Medium, or High), chiefComplaint, and exactly three suggestedQuestions. Treat emergency red flags as High.";
  const result = await requestJson(system, `Symptoms:\n${symptoms}`);
  const urgency = result?.urgency;
  const chiefComplaint = clean(result?.chiefComplaint);
  const questions = stringList(result?.suggestedQuestions);
  if ((urgency === "Low" || urgency === "Medium" || urgency === "High") && chiefComplaint && questions.length === 3) return { urgency, chiefComplaint, suggestedQuestions: questions, aiStatus: "ready" };
  const lower = symptoms.toLowerCase();
  const fallbackUrgency = RED_FLAGS.some((flag) => lower.includes(flag)) ? "High" : /fever|pain|vomit|dizz|wors/i.test(symptoms) ? "Medium" : "Low";
  return { urgency: fallbackUrgency, chiefComplaint: symptoms.split(/[.!?]/)[0].trim().slice(0, 240) || "Patient submitted symptoms for review", suggestedQuestions: ["When did these symptoms begin, and have they changed?", "What makes the symptoms better or worse?", "Have you taken any medication or noticed other symptoms?"], aiStatus: "fallback" };
}

export async function createPostVisitSummary(notes: string): Promise<PostVisitSummary> {
  const system = "Convert doctor-authored clinical notes into plain, calm language. Do not add diagnoses, medicines, doses, or advice that are absent from the notes. Return JSON only with summary, medicationSchedule array, and followUpSteps array.";
  const result = await requestJson(system, `Doctor notes:\n${notes}`);
  const summary = clean(result?.summary);
  if (summary) return { summary, medicationSchedule: stringList(result?.medicationSchedule), followUpSteps: stringList(result?.followUpSteps), aiStatus: "ready" };
  return { summary: `Your doctor recorded: ${notes}`, medicationSchedule: [], followUpSteps: ["Follow the prescription exactly as provided by your doctor.", "Contact the clinic if symptoms worsen or you are unsure about the plan."], aiStatus: "fallback" };
}
