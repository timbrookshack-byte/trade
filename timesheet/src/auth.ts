import type { Env } from "./env";

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time string equality (compares HMACs so lengths don't leak). */
async function safeEqual(secret: string, a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([hmac(secret, a), hmac(secret, b)]);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export type CookieKind = "kiosk" | "admin";
const COOKIE_NAME: Record<CookieKind, string> = { kiosk: "ts_kiosk", admin: "ts_admin" };
// Chrome caps cookie lifetime at 400 days; the kiosk cookie is refreshed on every page load.
export const KIOSK_MAX_AGE = 400 * 24 * 3600;
export const ADMIN_MAX_AGE = 12 * 3600;

export async function makeCookie(env: Env, kind: CookieKind, maxAge: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + maxAge;
  const payload = `${kind}.${exp}`;
  const value = `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
  return `${COOKIE_NAME[kind]}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(kind: CookieKind): string {
  return `${COOKIE_NAME[kind]}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export async function hasCookie(req: Request, env: Env, kind: CookieKind): Promise<boolean> {
  const raw = readCookie(req, COOKIE_NAME[kind]);
  if (!raw) return false;
  const [k, exp, sig] = raw.split(".");
  if (k !== kind || !exp || !sig) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  return safeEqual(env.SESSION_SECRET, sig, await hmac(env.SESSION_SECRET, `${k}.${exp}`));
}

const LOCK_WINDOW_MIN = 15;
const LOCK_AFTER_FAILS = 5;

export type CodeResult = { ok: true } | { ok: false; error: string; status: number };

/** Check the manager (Alex) code, with a lockout after repeated wrong codes. */
export async function checkManagerCode(env: Env, code: unknown): Promise<CodeResult> {
  const since = new Date(Date.now() - LOCK_WINDOW_MIN * 60_000).toISOString();
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM code_attempts WHERE ok = 0 AND at > ?").bind(since).first<{ n: number }>();
  if ((row?.n ?? 0) >= LOCK_AFTER_FAILS) {
    return { ok: false, status: 429, error: `Too many wrong manager codes. Try again in ${LOCK_WINDOW_MIN} minutes.` };
  }
  const ok = typeof code === "string" && code.length > 0 && !!env.MANAGER_CODE && (await safeEqual(env.SESSION_SECRET, code.trim(), env.MANAGER_CODE));
  await env.DB.prepare("INSERT INTO code_attempts (at, ok) VALUES (?, ?)").bind(new Date().toISOString(), ok ? 1 : 0).run();
  if (ok) return { ok: true };
  return { ok: false, status: 401, error: `That manager code isn't right.` };
}
