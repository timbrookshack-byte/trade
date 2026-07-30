import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { getOrder } from "~/lib/orders.server";
import { deliveryMethodLabel, type OrderItem, type Payment } from "~/lib/orders";
import { getSettings } from "~/lib/settings.server";
import { getPaymentInfo } from "~/lib/payment.server";
import { PaymentOptions } from "~/components/payment-options";
import { exGst, formatCurrency, formatDate } from "~/lib/utils";

export function meta({ data }: { data?: { docTitle?: string } }) {
  return [{ title: `${data?.docTitle ?? "Document"} — Trade Portal` }];
}

type DocType = "invoice" | "packing" | "quote";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const id = Number(params.id);
  if (!Number.isInteger(id)) throw new Response("Not found", { status: 404 });
  const data = await getOrder(context.db, id);
  if (!data) throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const typeRaw = url.searchParams.get("type");
  const type: DocType = typeRaw === "packing" || typeRaw === "quote" ? typeRaw : "invoice";
  const docTitle =
    type === "invoice" ? "Tax Invoice" : type === "packing" ? "Packing Slip" : "Quotation";

  const [settings, payment] = await Promise.all([
    getSettings(context, [
      "company_name",
      "company_abn",
      "company_phone",
      "company_email",
      "company_address",
    ]),
    getPaymentInfo(context),
  ]);
  // Packing slips carry no pricing — strip it server-side, not just visually.
  const scrubbed =
    type === "packing"
      ? {
          ...data,
          order: { ...data.order, total_inc_gst: "0" },
          items: data.items.map((i) => ({ ...i, unit_price_inc_gst: "0" })),
          payments: [],
          paid: 0,
          balance: 0,
        }
      : data;
  return {
    ...scrubbed,
    type,
    docTitle,
    payment,
    company: {
      name: settings.company_name || "The Furniture Shack — Trade",
      abn: settings.company_abn || "",
      phone: settings.company_phone || "",
      email: settings.company_email || "",
      address: settings.company_address || "",
    },
    today: new Date().toISOString(),
  };
}

export default function OrderDoc() {
  const { order, items, payments, paid, balance, type, docTitle, company, payment, today } =
    useLoaderData<typeof loader>();
  const total = Number(order.total_inc_gst);
  const showPrices = type !== "packing";

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 print:max-w-none print:p-0">
      <div className="mb-6 flex items-center gap-3 rounded-md border border-border bg-muted px-4 py-3 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:bg-brand/90"
        >
          Download PDF
        </button>
        <span className="text-sm text-muted-foreground">(choose "Save as PDF" in the dialog)</span>
        <Link to={`/admin/orders/${order.id}`} className="ml-auto text-sm underline underline-offset-4">
          Back to {order.status === "quote" ? "quote" : "order"}
        </Link>
      </div>

      <header className="mb-8 flex items-start justify-between border-b-2 border-black pb-4">
        <div>
          <p className="text-xl font-bold uppercase tracking-widest">The Furniture Shack</p>
          <p className="text-xs font-medium uppercase tracking-[0.35em] text-neutral-500">Trade</p>
          <div className="mt-3 text-xs text-neutral-600">
            <p>{company.name}</p>
            {company.abn && <p>ABN {company.abn}</p>}
            {company.address && <p className="whitespace-pre-line">{company.address}</p>}
            <p>
              {company.phone}
              {company.phone && company.email && " · "}
              {company.email}
            </p>
          </div>
        </div>
        <div className="text-right">
          <h1 className="text-2xl font-bold uppercase">{docTitle}</h1>
          <p className="mt-1 font-mono text-sm">{order.order_number}</p>
          <p className="text-xs text-neutral-500">Date: {formatDate(today)}</p>
          {type === "quote" && <p className="text-xs text-neutral-500">Valid for 30 days</p>}
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-8 text-sm">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {type === "packing" ? "Deliver to" : "Bill to"}
          </p>
          <p className="font-medium">{order.business_name || order.customer_name}</p>
          {order.business_name && order.customer_name && <p>{order.customer_name}</p>}
          {type !== "packing" && (
            <>
              <p>{order.customer_email}</p>
              <p>{order.customer_phone}</p>
            </>
          )}
          {order.delivery_address && <p className="whitespace-pre-line">{order.delivery_address}</p>}
          {order.delivery_method && (
            <p className="mt-1 font-medium">{deliveryMethodLabel(order.delivery_method)}</p>
          )}
          {order.urgent_date && (
            <p className="font-bold">URGENT — required by {formatDate(order.urgent_date)}</p>
          )}
        </div>
        {order.note && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Note
            </p>
            <p>{order.note}</p>
          </div>
        )}
      </section>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-2 pr-3 font-semibold">SKU</th>
            <th className="py-2 pr-3 font-semibold">Item</th>
            <th className="py-2 pr-3 text-right font-semibold">Qty</th>
            {showPrices && (
              <>
                <th className="py-2 pr-3 text-right font-semibold">Unit ex GST</th>
                <th className="py-2 text-right font-semibold">Total ex GST</th>
              </>
            )}
            {!showPrices && <th className="py-2 text-right font-semibold">Picked</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item: OrderItem) => (
            <tr key={item.id} className="border-b border-neutral-200 break-inside-avoid">
              <td className="py-2 pr-3 font-mono text-xs">{item.sku}</td>
              <td className="py-2 pr-3">{item.name}</td>
              <td className="py-2 pr-3 text-right">{item.quantity}</td>
              {showPrices ? (
                <>
                  <td className="py-2 pr-3 text-right">
                    {formatCurrency(exGst(Number(item.unit_price_inc_gst)))}
                  </td>
                  <td className="py-2 text-right">
                    {formatCurrency(exGst(item.quantity * Number(item.unit_price_inc_gst)))}
                  </td>
                </>
              ) : (
                <td className="py-2 text-right">☐</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {showPrices && (
        <div className="mt-4 flex justify-end">
          <div className="w-64 text-sm">
            <div className="flex justify-between py-1">
              <span className="text-neutral-500">Subtotal ex GST</span>
              <span>{formatCurrency(exGst(total))}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-neutral-500">GST (10%)</span>
              <span>{formatCurrency(total - exGst(total))}</span>
            </div>
            <div className="flex justify-between border-t-2 border-black py-2 text-base font-bold">
              <span>Total inc GST</span>
              <span>{formatCurrency(total)}</span>
            </div>
            {type === "invoice" && payments.length > 0 && (
              <>
                {payments.map((p: Payment) => (
                  <div key={p.id} className="flex justify-between py-1 text-neutral-500">
                    <span>
                      Paid {formatDate(p.paid_at)} ({p.method.toUpperCase()})
                    </span>
                    <span>−{formatCurrency(Number(p.amount))}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-neutral-300 py-2 font-bold">
                  <span>Balance due</span>
                  <span>{formatCurrency(Math.max(0, balance))}</span>
                </div>
              </>
            )}
            {type === "invoice" && payments.length === 0 && (
              <div className="flex justify-between py-2 font-bold">
                <span>Balance due</span>
                <span>{formatCurrency(total)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {(type === "invoice" || type === "quote") && (
        <section className="mt-8 rounded-md border border-neutral-300 p-4 break-inside-avoid">
          {type === "invoice" && balance <= 0 && payments.length > 0 ? (
            <p className="text-sm font-semibold">Paid in full — thank you.</p>
          ) : (
            <PaymentOptions payment={payment} orderRef={order.order_number ?? undefined} print />
          )}
        </section>
      )}

      <footer className="mt-6 border-t border-neutral-200 pt-3 text-xs text-neutral-500">
        {type === "invoice" && paid > 0 && balance > 0 && (
          <p>Amount paid to date: {formatCurrency(paid)}.</p>
        )}
        {type === "quote" && (
          <p>
            Line prices ex GST; the totals show the GST breakdown. Prices subject to change
            after 30 days. Stock subject to availability at time of order.
          </p>
        )}
        {type === "packing" && <p>Check quantities on pick. {order.order_number}.</p>}
      </footer>
    </div>
  );
}
