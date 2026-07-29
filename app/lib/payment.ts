// Client-safe payment info shape + defaults. The live values come from
// settings (see payment.server.ts) so the team can edit them without a deploy.

export interface PaymentInfo {
  phone: string;
  account_name: string;
  bsb: string;
  account_number: string;
  remittance_email: string;
}

export const PAYMENT_DEFAULTS: PaymentInfo = {
  phone: "0424 477 794",
  account_name: "The Furniture Shack Pty Ltd (NAB)",
  bsb: "084 129",
  account_number: "57 165 0656",
  remittance_email: "trade@thefurnitureshack.com.au",
};

export const CARD_TERMS = "Visa/Mastercard (no fee) or AMEX (1.95% surcharge)";
export const PAYMENT_POLICY = "Payment in full is required prior to dispatch.";
