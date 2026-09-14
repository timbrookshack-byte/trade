import type { AppLoadContext } from "react-router";
import { CARD_TERMS, PAYMENT_POLICY, type PaymentInfo } from "./payment";

/**
 * Emails via Resend (same as 360). Settings: resend_api_key (secret),
 * email_from (verified sender), email_notify (trade team inbox).
 * All sends are fire-and-forget through ctx.waitUntil — a missing key or a
 * Resend outage must never break the user-facing flow.
 */

async function send(
  context: AppLoadContext,
  message: { to: string[]; subject: string; html: string },
) {
  const rows = await context.db<{ key: string; value: string }[]>`
    SELECT key, value FROM settings WHERE key IN ('resend_api_key', 'email_from')
  `;
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const to = message.to.filter((addr) => addr.includes("@"));
  if (!settings.resend_api_key || !settings.email_from || to.length === 0) return;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.resend_api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: settings.email_from, to, subject: message.subject, html: message.html }),
  });
  if (!response.ok) {
    console.log("email send failed:", response.status, await response.text());
  }
}

/**
 * Diagnostic send: synchronous, and returns exactly what happened — which
 * setting is missing, or Resend's real API response. Normal sends stay
 * fire-and-forget; this exists so "no email arrived" can be diagnosed from
 * the Settings screen instead of guessing.
 */
export async function sendTestEmail(context: AppLoadContext, to: string) {
  const rows = await context.db<{ key: string; value: string }[]>`
    SELECT key, value FROM settings WHERE key IN ('resend_api_key', 'email_from')
  `;
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  if (!settings.resend_api_key) {
    return { ok: false, detail: "The Resend API key setting is empty — paste a key and save first." };
  }
  if (!settings.email_from) {
    return { ok: false, detail: "The from-address setting is empty — set it and save first." };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.resend_api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: settings.email_from,
        to: [to],
        subject: "Trade portal test email",
        html: brandedEmail(
          `<p>This is a test email from the trade portal's Settings page.</p>
           <p>If you're reading it, sending works: the Resend key is valid and the
           from address (${settings.email_from}) is on a verified domain.</p>`,
        ),
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = (await response.text()).slice(0, 400);
    return response.ok
      ? { ok: true, detail: `Resend accepted it (${body}) — check the inbox for ${to}, and it now shows in Resend's Emails log.` }
      : { ok: false, detail: `Resend refused it — HTTP ${response.status}: ${body}` };
  } catch (err) {
    return { ok: false, detail: `Couldn't reach Resend's API: ${String(err)}` };
  }
}

/** Queue an email without blocking the response. Errors are logged, never thrown. */
export function queueEmail(
  context: AppLoadContext,
  message: { to: string[]; subject: string; html: string },
) {
  context.cloudflare.ctx.waitUntil(
    send(context, message).catch((err) => console.log("email error:", String(err))),
  );
}

export async function getNotifyAddress(context: AppLoadContext) {
  const rows = await context.db<{ value: string }[]>`
    SELECT value FROM settings WHERE key = 'email_notify'
  `;
  return rows[0]?.value ?? "";
}

const paymentHtml = (payment: PaymentInfo, orderRef: string) => `
  <div style="border:1px solid #ddd; border-radius:8px; padding:16px; margin-top:16px; font-size:14px;">
    <p style="margin:0; font-weight:bold;">${PAYMENT_POLICY}</p>
    <p style="margin:12px 0 4px; font-size:11px; font-weight:bold; text-transform:uppercase; letter-spacing:1px;">Credit card payment</p>
    <p style="margin:0; color:#555;">Please call ${payment.phone} to pay via ${CARD_TERMS}.</p>
    <p style="margin:12px 0 4px; font-size:11px; font-weight:bold; text-transform:uppercase; letter-spacing:1px;">Direct deposit payment</p>
    <p style="margin:0; color:#555;">${payment.account_name}<br>
    BSB: ${payment.bsb} &nbsp;ACC: ${payment.account_number}<br>
    REF: <strong>${orderRef}</strong></p>
    <p style="margin:8px 0 0; color:#555;">Please email remittance advice to
    <a href="mailto:${payment.remittance_email}">${payment.remittance_email}</a>
    when paying by direct deposit.</p>
  </div>`;

/** Branded shell for one-off emails composed outside the template list. */
export const brandedEmail = (body: string) => wrap(body);

const wrap = (body: string) => `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
    <p style="letter-spacing: 4px; font-weight: bold; text-transform: uppercase;">The Furniture Shack <span style="color:#d6217f;">Trade</span></p>
    ${body}
    <p style="color:#888; font-size:12px; margin-top:32px;">This email was sent by the Furniture Shack trade portal.</p>
  </div>`;

export const emailTemplates = {
  registrationReceived: (contactName: string) => ({
    subject: "We've received your trade application",
    html: wrap(
      `<p>Hi ${contactName},</p>
       <p>Thanks for applying for a trade account with The Furniture Shack. Our team reviews
       applications against your business details — usually within one business day.</p>
       <p>We'll email you as soon as your account is approved.</p>`,
    ),
  }),
  registrationReceivedTeam: (businessName: string, email: string) => ({
    subject: `New trade application: ${businessName}`,
    html: wrap(
      `<p>A new trade application has been submitted by <strong>${businessName}</strong>
       (${email}).</p>
       <p><a href="https://thefurnitureshack.trade/admin/customers?filter=pending">Review pending applications</a></p>`,
    ),
  }),
  registrationApproved: (contactName: string) => ({
    subject: "Your trade account is approved",
    html: wrap(
      `<p>Hi ${contactName},</p>
       <p>Your trade account has been approved. Log in to see your trade pricing, live
       availability, and to order online any time.</p>
       <p><a href="https://thefurnitureshack.trade/trade/login">Sign in to the trade portal</a></p>`,
    ),
  }),
  orderSubmitted: (orderNumber: string, totalIncGst: string, payment: PaymentInfo) => ({
    subject: `Order ${orderNumber} received`,
    html: wrap(
      `<p>Thanks — we've received your order <strong>${orderNumber}</strong>
       (total ${totalIncGst} inc GST).</p>
       <p>The trade team will confirm it shortly and send an invoice.</p>
       ${paymentHtml(payment, orderNumber)}
       <p><a href="https://thefurnitureshack.trade/account/orders">View your orders</a></p>`,
    ),
  }),
  orderSubmittedTeam: (orderNumber: string, businessName: string, totalIncGst: string) => ({
    subject: `New order ${orderNumber} — ${businessName}`,
    html: wrap(
      `<p><strong>${businessName}</strong> just submitted order
       <strong>${orderNumber}</strong> (${totalIncGst} inc GST).</p>
       <p><a href="https://thefurnitureshack.trade/admin/orders">Open orders in admin</a></p>`,
    ),
  }),
  orderConfirmed: (orderNumber: string, payment: PaymentInfo) => ({
    subject: `Order ${orderNumber} confirmed`,
    html: wrap(
      `<p>Your order <strong>${orderNumber}</strong> has been confirmed. We'll be in touch
       with your invoice; dispatch happens once payment clears.</p>
       ${paymentHtml(payment, orderNumber)}`,
    ),
  }),
  orderDispatched: (orderNumber: string) => ({
    subject: `Order ${orderNumber} dispatched`,
    html: wrap(
      `<p>Good news — your order <strong>${orderNumber}</strong> has been dispatched.</p>`,
    ),
  }),
};
