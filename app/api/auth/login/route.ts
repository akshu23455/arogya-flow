import { env } from "cloudflare:workers";
import { sessionCookie, signSession, verifyPassword, type AppRole } from "@/lib/auth";

type UserRow = { id: string; email: string; full_name: string; role: AppRole; password_hash: string | null };

export async function POST(request: Request) {
  const input = await request.json() as { email?: string; password?: string };
  const email = input.email?.trim().toLowerCase() ?? "";
  const user = await env.DB.prepare("SELECT id, email, full_name, role, password_hash FROM users WHERE email = ? LIMIT 1").bind(email).first<UserRow>();
  if (!user?.password_hash || !(await verifyPassword(input.password ?? "", user.password_hash))) {
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }
  const token = await signSession({ sub: user.id, email: user.email, role: user.role });
  return Response.json({ user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role } }, { headers: { "Set-Cookie": sessionCookie(token) } });
}
