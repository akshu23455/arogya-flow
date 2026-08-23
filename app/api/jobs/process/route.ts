import { env } from "cloudflare:workers";
import { readSession } from "@/lib/auth";
import { dispatchJob } from "@/lib/providers";

type Job = { id: string; channel: "email" | "calendar"; recipient: string; payload_json: string; appointment_id: string | null; attempts: number };

async function authorised(request: Request): Promise<boolean> {
  const expected = (env as unknown as Record<string, unknown>).WORKER_SECRET;
  if (typeof expected === "string" && request.headers.get("authorization") === `Bearer ${expected}`) return true;
  return (await readSession(request))?.role === "admin";
}

export async function POST(request: Request) {
  if (!(await authorised(request))) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const rows = await env.DB.prepare("SELECT id, channel, recipient, payload_json, appointment_id, attempts FROM notification_jobs WHERE status IN ('pending','retrying') AND next_attempt_at <= CURRENT_TIMESTAMP ORDER BY created_at LIMIT 20").all<Job>();
  const result = { delivered: 0, retrying: 0, deadLetter: 0 };
  for (const job of rows.results) {
    const claim = await env.DB.prepare("UPDATE notification_jobs SET status = 'processing' WHERE id = ? AND status IN ('pending','retrying')").bind(job.id).run();
    if ((claim.meta.changes ?? 0) !== 1) continue;
    try {
      await dispatchJob(job);
      await env.DB.prepare("UPDATE notification_jobs SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?").bind(job.id).run();
      result.delivered += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const status = attempts >= 5 ? "dead_letter" : "retrying";
      const delayMinutes = Math.min(60, 2 ** attempts);
      await env.DB.prepare("UPDATE notification_jobs SET status = ?, attempts = ?, next_attempt_at = datetime('now', '+' || ? || ' minutes'), last_error = ? WHERE id = ?").bind(status, attempts, delayMinutes, error instanceof Error ? error.message.slice(0, 500) : "Unknown provider error", job.id).run();
      if (status === "dead_letter") result.deadLetter += 1; else result.retrying += 1;
    }
  }
  return Response.json({ processed: rows.results.length, ...result });
}
