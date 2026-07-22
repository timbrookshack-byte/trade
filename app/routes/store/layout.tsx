import {
  Form,
  Link,
  NavLink,
  Outlet,
  useLoaderData,
  type LoaderFunctionArgs,
} from "react-router";
import { getCustomer } from "~/lib/customer-auth.server";
import { readCart } from "~/lib/cart.server";
import { getSettings } from "~/lib/settings.server";
import { cn } from "~/lib/utils";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const [customer, settings, cart] = await Promise.all([
    getCustomer(context, request),
    getSettings(context, ["company_name", "company_phone", "company_email", "company_address"]),
    readCart(context, request),
  ]);
  return {
    cartCount: cart.reduce((sum, l) => sum + l.qty, 0),
    customer: customer
      ? {
          businessName: customer.business_name,
          contactName: customer.contact_name,
          approved: customer.approved,
        }
      : null,
    company: {
      name: settings.company_name || "The Furniture Shack — Trade",
      phone: settings.company_phone || "",
      email: settings.company_email || "",
      address: settings.company_address || "",
    },
  };
}

export default function StoreLayout() {
  const { customer, company, cartCount } = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-4">
          <Link to="/" className="shrink-0">
            <span className="block text-lg font-bold uppercase tracking-widest leading-none">
              The Furniture Shack
            </span>
            <span className="block text-xs font-medium uppercase tracking-[0.35em] text-muted-foreground">
              Trade
            </span>
          </Link>
          <nav className="flex items-center gap-5 text-sm font-medium">
            <NavLink
              to="/products"
              className={({ isActive }) =>
                cn("hover:text-primary", isActive && "underline underline-offset-8")
              }
            >
              Products
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {customer ? (
              <>
                <NavLink to="/account/orders" className="underline-offset-4 hover:underline">
                  Orders
                </NavLink>
                <NavLink to="/cart" className="font-medium underline-offset-4 hover:underline">
                  Cart{cartCount > 0 && <span className="ml-1 rounded-full bg-brand px-1.5 text-xs text-brand-foreground">{cartCount}</span>}
                </NavLink>
                <span className="hidden text-muted-foreground sm:inline">
                  {customer.businessName}
                </span>
                {!customer.approved && (
                  <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium">
                    application under review
                  </span>
                )}
                <Form method="post" action="/trade/logout">
                  <button type="submit" className="underline-offset-4 hover:underline">
                    Sign out
                  </button>
                </Form>
              </>
            ) : (
              <>
                <Link to="/trade/login" className="underline-offset-4 hover:underline">
                  Trade login
                </Link>
                <Link
                  to="/trade/apply"
                  className="rounded-md bg-brand px-3.5 py-2 font-medium text-brand-foreground hover:bg-brand/90"
                >
                  Apply for trade
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-6 px-4 py-8 text-sm text-muted-foreground">
          <div>
            <p className="font-semibold text-foreground">{company.name}</p>
            {company.address && <p className="mt-1 whitespace-pre-line">{company.address}</p>}
          </div>
          <div className="space-y-1">
            {company.phone && <p>{company.phone}</p>}
            {company.email && <p>{company.email}</p>}
          </div>
          <div className="space-y-1">
            <p>
              <Link to="/trade/apply" className="underline-offset-4 hover:underline">
                Apply for a trade account
              </Link>
            </p>
            <p>
              <Link to="/admin" className="underline-offset-4 hover:underline">
                Trade team sign in
              </Link>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
