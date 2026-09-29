import type { Sql } from "./db.server";
import type { Customer } from "./customer-auth.server";
import { CUSTOMER_FILTERS, type CustomerFilter } from "./customers";

// Whitelisted sort keys → SQL expressions (used via db.unsafe, never user text).
export const CUSTOMER_SORTS: Record<string, string> = {
  business: "lower(c.business_name)",
  applied: "c.created_at",
  last_login: "c.last_login_at",
  last_order: "last_order_at",
};

export type CustomerRow = Customer & {
  last_login_at: string | null;
  last_order_at: string | null;
  last_order_external: string | null;
  invited_at: string | null;
  has_password: boolean;
};

export function parseCustomerQuery(url: URL) {
  const filterParam = url.searchParams.get("filter");
  const filter: CustomerFilter = CUSTOMER_FILTERS.some((f) => f.key === filterParam)
    ? (filterParam as CustomerFilter)
    : "pending";
  const sortParam = url.searchParams.get("sort") ?? "";
  return {
    filter,
    sort: CUSTOMER_SORTS[sortParam] ? sortParam : "applied",
    dir: url.searchParams.get("dir") === "asc" ? ("asc" as const) : ("desc" as const),
    search: (url.searchParams.get("q") ?? "").trim(),
  };
}

export function listCustomers(
  db: Sql,
  opts: { filter: CustomerFilter; sort: string; dir: "asc" | "desc"; search: string },
) {
  const term = opts.search ? `%${opts.search}%` : null;
  return db<CustomerRow[]>`
    SELECT c.id, c.business_name, c.abn, c.business_type, c.contact_name, c.email, c.phone,
           c.address, c.price_tier, c.credit_terms, c.approved, c.approved_at, c.active,
           c.created_at, c.last_login_at, c.invited_at,
           c.how_heard, c.website, c.social_media, c.current_projects, c.additional_info,
           c.existing_client, c.last_order_external,
           (c.password_hash <> '') AS has_password,
           (SELECT MAX(o.submitted_at) FROM orders o
            WHERE o.customer_id = c.id AND o.status <> 'quote') AS last_order_at
    FROM customers c
    WHERE CASE ${opts.filter}
        WHEN 'pending' THEN NOT c.approved AND c.active
        WHEN 'approved' THEN c.approved AND c.active
        WHEN 'new' THEN NOT c.existing_client AND c.active
        ELSE TRUE
      END
      AND (${term}::text IS NULL
           OR c.business_name ILIKE ${term} OR c.contact_name ILIKE ${term}
           OR c.email ILIKE ${term} OR c.phone ILIKE ${term}
           OR replace(c.abn, ' ', '') ILIKE replace(${term}::text, ' ', ''))
    ORDER BY ${db.unsafe(CUSTOMER_SORTS[opts.sort])} ${db.unsafe(opts.dir === "asc" ? "ASC" : "DESC")} NULLS LAST
  `;
}
