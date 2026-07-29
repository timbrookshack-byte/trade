import type { AppLoadContext } from "react-router";
import { getSettings } from "./settings.server";
import { PAYMENT_DEFAULTS, type PaymentInfo } from "./payment";

export type { PaymentInfo };

/** Payment details for invoices/order pages — settings with sensible defaults. */
export async function getPaymentInfo(context: AppLoadContext): Promise<PaymentInfo> {
  const s = await getSettings(context, [
    "payment_phone",
    "payment_account_name",
    "payment_bsb",
    "payment_account_number",
    "payment_remittance_email",
  ]);
  return {
    phone: s.payment_phone || PAYMENT_DEFAULTS.phone,
    account_name: s.payment_account_name || PAYMENT_DEFAULTS.account_name,
    bsb: s.payment_bsb || PAYMENT_DEFAULTS.bsb,
    account_number: s.payment_account_number || PAYMENT_DEFAULTS.account_number,
    remittance_email: s.payment_remittance_email || PAYMENT_DEFAULTS.remittance_email,
  };
}
