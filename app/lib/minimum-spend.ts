// Minimum spend on a new commercial customer's FIRST order. The threshold lives in
// settings (`minimum_order_amount`) so the team can change it without a deploy;
// this module holds the client-safe default and the customer-facing copy.
import { formatCurrency } from "./utils";

/** Default minimum first-order spend, ex GST (commercial prices are quoted ex). */
export const MINIMUM_SPEND_DEFAULT = 5000;

/**
 * Deliberately soft — a nudge and a promise to follow up, never a blocker.
 * Nothing in the portal stops an under-threshold order being submitted.
 */
export function minimumSpendNotice(minimumExGst: number) {
  return `Your purchase does not meet the minimum threshold of ${formatCurrency(
    minimumExGst,
  )} for commercial orders — we'll be in touch to discuss and work out how we can help with your project.`;
}
