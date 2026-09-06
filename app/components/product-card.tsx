import { Link } from "react-router";
import { productPhoto, type Product } from "~/lib/products";
import { stockStatus } from "~/lib/stock";
import { cn, exGst, formatCurrency } from "~/lib/utils";

function stockBadgeClass(kind: string) {
  switch (kind) {
    case "in_stock":
      return "bg-green-600/10 text-green-800";
    case "low":
      return "bg-amber-500/15 text-amber-800";
    case "incoming":
      return "bg-blue-500/10 text-blue-800";
    default:
      return "bg-muted text-muted-foreground";
  }
}

/** The storefront product card — products gallery and project "shop the look". */
export function ProductCard({
  product: p,
  showPrices,
  imageFit,
}: {
  product: Product;
  showPrices: boolean;
  imageFit: string;
}) {
  const stock = stockStatus(p);
  return (
    <Link
      to={`/products/${encodeURIComponent(p.sku)}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="aspect-square w-full overflow-hidden bg-muted">
        {productPhoto(p) ? (
          <img
            src={productPhoto(p)}
            alt={p.name}
            loading="lazy"
            className={
              imageFit === "contain"
                ? "h-full w-full bg-white object-contain p-2"
                : "h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            }
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl text-muted-foreground/40">
            ▪
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{p.category}</p>
        <p className="font-medium leading-snug group-hover:underline group-hover:underline-offset-4">
          {p.name}
        </p>
        <div className="mt-auto flex items-center justify-between pt-2">
          {showPrices ? (
            <div>
              {p.trade_price != null && (
                <p className="font-semibold">
                  {formatCurrency(exGst(Number(p.trade_price)))}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">ex GST</span>
                </p>
              )}
              {p.rrp_reference != null && (
                <p className="text-xs text-muted-foreground">
                  RRP {formatCurrency(Number(p.rrp_reference))}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Trade price on login</p>
          )}
          {showPrices && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                stockBadgeClass(stock.kind),
              )}
            >
              {stock.label}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
