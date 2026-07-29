import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { listFaqs } from "~/lib/content.server";
import { toParagraphs, type Faq } from "~/lib/content";
import { getPaymentInfo } from "~/lib/payment.server";
import { PaymentOptions } from "~/components/payment-options";

export function meta() {
  return [
    { title: "FAQ — The Furniture Shack Trade" },
    { name: "description", content: "Common questions about trade accounts, ordering and delivery." },
  ];
}

export async function loader({ context }: LoaderFunctionArgs) {
  const [faqs, payment] = await Promise.all([listFaqs(context), getPaymentInfo(context)]);
  return { faqs, payment };
}

export default function FaqPage() {
  const { faqs, payment } = useLoaderData<typeof loader>();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 py-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">FAQ</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">Frequently asked questions</h1>
      </div>

      {faqs.length === 0 ? (
        <p className="text-muted-foreground">
          Nothing here yet — questions are added in Admin → Content.
        </p>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {faqs.map((faq: Faq) => (
            <details key={faq.id} className="group px-6 py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                {faq.question}
                <span className="text-xl text-brand transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <div className="mt-3 space-y-3 text-muted-foreground">
                {toParagraphs(faq.answer).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}

      <div id="payment">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">Payment</p>
        <h2 className="mt-3 text-2xl font-bold tracking-tight">Payment options</h2>
        <div className="mt-4 rounded-xl border border-border bg-card p-6">
          <PaymentOptions payment={payment} />
          <p className="mt-3 text-sm text-muted-foreground">
            Your payment reference is the order number shown on your invoice.
          </p>
        </div>
      </div>

      <p className="text-muted-foreground">
        Still have a question?{" "}
        <Link to="/contact" className="font-medium text-brand underline underline-offset-4">
          Get in touch
        </Link>{" "}
        — the trade team is happy to help.
      </p>
    </div>
  );
}
