import { useState } from "react";
import { Form, useSearchParams } from "react-router";
import { Search, X } from "lucide-react";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";

/**
 * Magnifying glass in the site header — the same product search as the
 * products/category page (GET /products?q=…), on every storefront page.
 * Opens a full-width bar under the header rather than squeezing an input
 * into the nav, so it still works at iPad and phone widths.
 */
export function HeaderSearch() {
  const [params] = useSearchParams();
  const current = params.get("q") ?? "";
  // Open on a search results page so the term stays visible and editable.
  const [open, setOpen] = useState(Boolean(current));
  // Only grab focus when the customer opened it — never on page load.
  const [focusOnOpen, setFocusOnOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFocusOnOpen(true);
          setOpen((v) => !v);
        }}
        aria-label={open ? "Close search" : "Search products"}
        aria-expanded={open}
        className="rounded-md p-1.5 text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
      >
        {open ? <X className="size-5" /> : <Search className="size-5" />}
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full border-b border-border bg-background shadow-sm">
          <Form
            method="get"
            action="/products"
            className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3"
          >
            <Input
              // Remount on a new search so the box shows the current term.
              key={current}
              name="q"
              type="search"
              defaultValue={current}
              autoFocus={focusOnOpen}
              placeholder="Search products by name, SKU or category…"
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </Form>
        </div>
      )}
    </>
  );
}
