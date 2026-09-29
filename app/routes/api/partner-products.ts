import type { LoaderFunctionArgs } from "react-router";
import { authenticatePartner, partnerProducts } from "~/lib/partner.server";

/**
 * GET /api/partner/products — read-only catalogue feed for partners.
 * Auth: `Authorization: Bearer tpk_…` or `?token=tpk_…` (same convention as
 * 360's trade feed). Returns only what the public storefront could show,
 * plus RRP and a stock band; trade prices only on keys created with them.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const bearer = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const token = bearer || url.searchParams.get("token") || "";
  const key = token ? await authenticatePartner(context.db, token) : null;
  if (!key) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  const feed = await partnerProducts(context, key);
  return Response.json(feed, {
    headers: {
      // Partners may poll from busy sites — let edges hold a copy briefly.
      "Cache-Control": "private, max-age=300",
    },
  });
}
