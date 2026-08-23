import { env } from "cloudflare:workers";
import { hashPassword, sessionCookie, signSession } from "@/lib/auth";

export async function POST(request: Request) {
  const input = await request.json() as { fullName?: string; email?: string; password?: string };
  const fullName = input.fullName?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  const password = input.password ?? "";
  if (fullName.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 10) {
    return Response.json({ error: "Use a valid name, email, and password of at least 10 characters" }, { status: 400 });
  }
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare("INSERT INTO users (id, email, full_name, role, password_hash) VALUES (?, ?, ?, 'patient', ?)")
      .bind(id, email, fullName, await hashPassword(password)).run();
    const token = await signSession({ sub: id, email, role: "patient" });
    return Response.json({ user: { id, email, fullName, role: "patient" } }, { status: 201, headers: { "Set-Cookie": sessionCookie(token) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) return Response.json({ error: "An account already exists for this email" }, { status: 409 });
    return Response.json({ error: "Registration is temporarily unavailable" }, { status: 503 });
  }
}
