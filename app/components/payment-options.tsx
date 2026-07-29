import { CARD_TERMS, PAYMENT_POLICY, type PaymentInfo } from "~/lib/payment";

/**
 * The payment options block, shared by the customer order page, the FAQ page
 * and (in print styling) the tax invoice. `orderRef` prints the payment
 * reference line; leave it off for the generic site explainer.
 */
export function PaymentOptions({
  payment,
  orderRef,
  print = false,
}: {
  payment: PaymentInfo;
  orderRef?: string;
  print?: boolean;
}) {
  const muted = print ? "text-neutral-600" : "text-muted-foreground";
  return (
    <div className={print ? "text-xs" : "text-sm"}>
      <p className="font-semibold">{PAYMENT_POLICY}</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide">Credit card payment</p>
          <p className={`mt-1 ${muted}`}>
            Please call{" "}
            <a href={`tel:${payment.phone.replace(/\s+/g, "")}`} className="font-medium">
              {payment.phone}
            </a>{" "}
            to pay via {CARD_TERMS}.
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide">Direct deposit payment</p>
          <p className={`mt-1 ${muted}`}>{payment.account_name}</p>
          <p className={muted}>
            BSB: <span className="font-mono">{payment.bsb}</span> · ACC:{" "}
            <span className="font-mono">{payment.account_number}</span>
          </p>
          {orderRef && (
            <p className={muted}>
              REF: <span className="font-mono font-medium">{orderRef}</span>
            </p>
          )}
          <p className={`mt-1 ${muted}`}>
            Please email remittance advice to{" "}
            <a href={`mailto:${payment.remittance_email}`} className="underline underline-offset-2">
              {payment.remittance_email}
            </a>{" "}
            when paying by direct deposit.
          </p>
        </div>
      </div>
    </div>
  );
}
