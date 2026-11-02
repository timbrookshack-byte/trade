import type { AppLoadContext } from "react-router";
import { getSettings } from "./settings.server";

/**
 * Cloudflare Turnstile (invisible CAPTCHA) for the public forms. Optional:
 * when the settings keys are blank, verification passes — the heuristic
 * filters in the contact action still apply. Fail-OPEN on network errors so
 * a Cloudflare hiccup never locks real customers out of the forms.
 * Settings: turnstile_site_key (public), turnstile_secret (write-only).
 */
export async function getTurnstileSiteKey(context: AppLoadContext) {
  const s = await getSettings(context, ["turnstile_site_key", "turnstile_secret"]);
  return s.turnstile_site_key && s.turnstile_secret ? s.turnstile_site_key : "";
}

export async function verifyTurnstile(context: AppLoadContext, request: Request, form: FormData) {
  const s = await getSettings(context, ["turnstile_secret"]);
  if (!s.turnstile_secret) return true;
  const token = String(form.get("cf-turnstile-response") ?? "");
  if (!token) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: s.turnstile_secret,
        response: token,
        remoteip: request.headers.get("CF-Connecting-IP") ?? undefined,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const result = (await response.json()) as { success?: boolean };
    return Boolean(result.success);
  } catch (err) {
    console.log("turnstile verify failed open:", String(err));
    return true;
  }
}

/** Obvious machine spam: links in the message (real enquiries describe, they
 * don't link) or a byte-identical recent repeat from the same email. */
export async function isContactSpam(
  context: AppLoadContext,
  email: string,
  message: string,
) {
  if (/https?:\/\/|www\.|t\.me\/|telegra\.ph|\.link\//i.test(message)) return true;
  const [dupe] = await context.db<{ n: number }[]>`
    SELECT count(*)::int AS n FROM contact_messages
    WHERE lower(email) = lower(${email}) AND message = ${message}
      AND created_at > now() - interval '7 days'
  `;
  return (dupe?.n ?? 0) > 0;
}
