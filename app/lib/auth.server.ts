import {
  createCookieSessionStorage,
  redirect,
  type AppLoadContext,
} from "react-router";

export type Role = "admin" | "staff";

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  created_at: string;
}

// --- Password hashing (PBKDF2-SHA256 via WebCrypto; no native bcrypt on Workers)

const PBKDF2_ITERATIONS = 100_000;

async function deriveBits(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveBits(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const salt = fromBase64(parts[2]);
  const expected = fromBase64(parts[3]);
  const actual = await deriveBits(password, salt, iterations);
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
  return diff === 0;
}

// --- Sessions (signed HTTP-only cookie)

function getSessionStorage(env: Env) {
  return createCookieSessionStorage({
    cookie: {
      name: "__tp_session",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: import.meta.env.PROD,
      secrets: [env.SESSION_SECRET],
      maxAge: 60 * 60 * 24 * 14, // 14 days
    },
  });
}

export async function createUserSession(
  context: AppLoadContext,
  userId: number,
  redirectTo: string,
) {
  const storage = getSessionStorage(context.cloudflare.env);
  const session = await storage.getSession();
  session.set("userId", userId);
  return redirect(redirectTo, {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

export async function logout(context: AppLoadContext, request: Request) {
  const storage = getSessionStorage(context.cloudflare.env);
  const session = await storage.getSession(request.headers.get("Cookie"));
  return redirect("/admin/login", {
    headers: { "Set-Cookie": await storage.destroySession(session) },
  });
}

export async function getUser(
  context: AppLoadContext,
  request: Request,
): Promise<User | null> {
  const storage = getSessionStorage(context.cloudflare.env);
  const session = await storage.getSession(request.headers.get("Cookie"));
  const userId = Number(session.get("userId"));
  if (!Number.isInteger(userId) || userId < 1) return null;
  const rows = await context.db<User[]>`
    SELECT id, email, name, role, active, created_at
    FROM users
    WHERE id = ${userId} AND active = TRUE
  `;
  return rows[0] ?? null;
}

/** Loader/action guard for admin-panel routes. Throws a redirect when not authed. */
export async function requireUser(
  context: AppLoadContext,
  request: Request,
  opts: { role?: Role } = {},
): Promise<User> {
  const user = await getUser(context, request);
  if (!user) {
    const url = new URL(request.url);
    const redirectTo = url.pathname + url.search;
    throw redirect(`/admin/login?redirectTo=${encodeURIComponent(redirectTo)}`);
  }
  if (opts.role === "admin" && user.role !== "admin") {
    throw new Response("Forbidden — admin role required", { status: 403 });
  }
  return user;
}

// --- User management

export async function countUsers(context: AppLoadContext) {
  const rows = await context.db<{ count: string }[]>`SELECT count(*) FROM users`;
  return Number(rows[0].count);
}

export async function verifyLogin(
  context: AppLoadContext,
  email: string,
  password: string,
) {
  const rows = await context.db<(User & { password_hash: string })[]>`
    SELECT id, email, name, role, active, created_at, password_hash
    FROM users
    WHERE lower(email) = lower(${email}) AND active = TRUE
  `;
  const user = rows[0];
  if (!user) return null;
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return null;
  const { password_hash: _discard, ...safe } = user;
  return safe as User;
}

export async function createUser(
  context: AppLoadContext,
  input: { email: string; name: string; password: string; role: Role },
) {
  const password_hash = await hashPassword(input.password);
  const rows = await context.db<User[]>`
    INSERT INTO users (email, name, password_hash, role)
    VALUES (lower(${input.email}), ${input.name}, ${password_hash}, ${input.role})
    RETURNING id, email, name, role, active, created_at
  `;
  return rows[0];
}
