import type { AppLoadContext } from "react-router";
import { createInviteToken } from "./customer-auth.server";
import { brandedEmail, queueEmail } from "./email.server";
import { getSettings } from "./settings.server";

/**
 * Launch invite drip: emails existing (imported) customers a personal
 * set-password link, in daily-capped batches so the Resend plan's send
 * limits are never blown. Rides the 15-minute cron while
 * `launch_invites_enabled` is 'true'; each run sends at most BATCH_PER_RUN,
 * and at most `launch_invites_daily_cap` (default 80) per Brisbane day.
 * Recently-active customers (old portal's last order date) go first.
 */
const BATCH_PER_RUN = 25;

export interface DripResult {
  skipped?: string;
  sent: number;
  sentToday: number;
  cap: number;
  remainingTotal: number;
}

export async function runLaunchInviteDrip(
  context: AppLoadContext,
  opts: { force?: boolean } = {},
): Promise<DripResult> {
  const db = context.db;
  const settings = await getSettings(context, [
    "launch_invites_enabled",
    "launch_invites_daily_cap",
    "resend_api_key",
    "email_from",
  ]);
  const cap = Math.max(1, Number(settings.launch_invites_daily_cap) || 80);

  const [counts] = await db<{ sent_today: number; remaining: number }[]>`
    SELECT count(*) FILTER (
             WHERE (invited_at AT TIME ZONE 'Australia/Brisbane')::date
                 = (now() AT TIME ZONE 'Australia/Brisbane')::date
           )::int AS sent_today,
           count(*) FILTER (
             WHERE invited_at IS NULL AND approved AND active AND password_hash = ''
           )::int AS remaining
    FROM customers
  `;
  const base: DripResult = {
    sent: 0,
    sentToday: counts?.sent_today ?? 0,
    cap,
    remainingTotal: counts?.remaining ?? 0,
  };

  if (!opts.force && settings.launch_invites_enabled !== "true") {
    return { ...base, skipped: "campaign paused" };
  }
  if (!settings.resend_api_key || !settings.email_from) {
    return { ...base, skipped: "Resend isn't configured (Settings → email)" };
  }
  if (base.remainingTotal === 0) return { ...base, skipped: "everyone invited" };
  const quota = Math.min(BATCH_PER_RUN, cap - base.sentToday);
  if (quota <= 0) return { ...base, skipped: "daily cap reached" };

  const batch = await db<{ id: number; contact_name: string; email: string }[]>`
    SELECT id, contact_name, email FROM customers
    WHERE invited_at IS NULL AND approved AND active AND password_hash = ''
    ORDER BY last_order_external DESC NULLS LAST, created_at ASC
    LIMIT ${quota}
  `;
  const origin = String(await getSettings(context, ["portal_origin"]).then(
    (s) => s.portal_origin || "https://thefurnitureshack.trade",
  ));

  for (const customer of batch) {
    const path = await createInviteToken(context, customer.id);
    queueEmail(context, {
      to: [customer.email],
      subject: "Your Furniture Shack trade account is ready",
      html: brandedEmail(
        `<p>Hi ${customer.contact_name},</p>
         <p>We've moved trade ordering to our new trade portal — your account has
         come across with it, so there's nothing to re-apply for. Set a password
         and you're in, with your trade pricing and live stock:</p>
         <p style="margin:24px 0;">
           <a href="${origin}${path}"
              style="background:#111; color:#fff; padding:12px 24px; border-radius:6px;
                     text-decoration:none; font-weight:bold;">Set my password</a>
         </p>
         <p>This link is valid for 14 days. If it expires, use
         "Forgot your password?" on the <a href="${origin}/trade/login">login
         page</a> with this email address and we'll send a fresh one.</p>`,
      ),
    });
    await db`UPDATE customers SET invited_at = now() WHERE id = ${customer.id}`;
  }
  return {
    ...base,
    sent: batch.length,
    sentToday: base.sentToday + batch.length,
    remainingTotal: base.remainingTotal - batch.length,
  };
}

/** Clear invited_at for customers invited over `days` ago who still have no
 * password, so the drip re-sends to them. Returns how many were re-queued. */
export async function requeueUnactivated(context: AppLoadContext, days = 7) {
  const rows = await context.db<{ id: number }[]>`
    UPDATE customers SET invited_at = NULL
    WHERE password_hash = '' AND approved AND active
      AND invited_at IS NOT NULL AND invited_at < now() - (${days} * interval '1 day')
    RETURNING id
  `;
  return rows.length;
}
