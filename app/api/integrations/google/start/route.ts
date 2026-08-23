import { env } from "cloudflare:workers";
import { requireRole } from "@/lib/auth";

export async function GET(request: Request) {
  const session = await requireRole(request, ["patient", "doctor"]);
  if (session instanceof Response) return session;
  const runtime = env as unknown as Record<string, unknown>;
  const clientId = runtime.GOOGLE_CLIENT_ID;
  const redirectUri = runtime.GOOGLE_REDIRECT_URI;
  if (typeof clientId !== "string" || typeof redirectUri !== "string") return Response.json({ error: "Google Calendar is not configured" }, { status: 503 });
  const state = crypto.randomUUID();
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent", scope: "https://www.googleapis.com/auth/calendar.events", state });
  return new Response(null, { status: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, "Set-Cookie": `arogyaflow_oauth_state=${state}; Path=/api/integrations/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } });
}
