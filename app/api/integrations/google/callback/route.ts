import { env } from "cloudflare:workers";
import { requireRole } from "@/lib/auth";
import { encryptSecret } from "@/lib/secrets";

function cookieValue(request: Request, name: string): string | undefined {
  return (request.headers.get("cookie") ?? "").split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function GET(request: Request) {
  const session = await requireRole(request, ["patient", "doctor"]);
  if (session instanceof Response) return session;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== cookieValue(request, "arogyaflow_oauth_state")) return Response.json({ error: "OAuth state validation failed" }, { status: 400 });
  const runtime = env as unknown as Record<string, unknown>;
  const body = new URLSearchParams({ code, client_id: String(runtime.GOOGLE_CLIENT_ID ?? ""), client_secret: String(runtime.GOOGLE_CLIENT_SECRET ?? ""), redirect_uri: String(runtime.GOOGLE_REDIRECT_URI ?? ""), grant_type: "authorization_code" });
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!tokenResponse.ok) return Response.json({ error: "Google authorisation could not be completed" }, { status: 502 });
  const token = await tokenResponse.json() as { refresh_token?: string; scope?: string };
  if (!token.refresh_token) return Response.json({ error: "Google did not return an offline refresh token; reconnect with consent" }, { status: 502 });
  await env.DB.prepare(`
    INSERT INTO calendar_connections (user_id, refresh_token_ciphertext, calendar_id, scopes)
    VALUES (?, ?, 'primary', ?)
    ON CONFLICT(user_id) DO UPDATE SET refresh_token_ciphertext = excluded.refresh_token_ciphertext, scopes = excluded.scopes, updated_at = CURRENT_TIMESTAMP
  `).bind(session.sub, await encryptSecret(token.refresh_token), token.scope ?? "https://www.googleapis.com/auth/calendar.events").run();
  return new Response(null, { status: 302, headers: { Location: "/?calendar=connected", "Set-Cookie": "arogyaflow_oauth_state=; Path=/api/integrations/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0" } });
}
