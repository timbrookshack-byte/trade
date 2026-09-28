import type { LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { businessTypeLabel } from "~/lib/customers";
import { listCustomers, parseCustomerQuery, type CustomerRow } from "~/lib/customers.server";
import { formatDate } from "~/lib/utils";

/** RFC4180-ish: quote everything, double any embedded quotes. */
function csvRow(values: (string | null | undefined)[]) {
  return values.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",");
}

/**
 * Mailchimp wants "Email Address" plus first/last name columns, so the
 * contact name is split on the first space as well as given whole.
 */
function splitName(contactName: string) {
  const parts = contactName.trim().split(/\s+/);
  if (parts.length < 2) return { first: contactName.trim(), last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

const HEADERS = [
  "Email Address",
  "First Name",
  "Last Name",
  "Contact Name",
  "Business Name",
  "Phone",
  "ABN",
  "Address",
  "Business Type",
  "Status",
  "Client Type",
  "Password Set",
  "Invited",
  "Added",
  "Last Login",
  "Last Order",
];

/**
 * CSV of exactly the customers the admin list is showing (same filter,
 * search and sort) — for Mailchimp and the like. Outside the admin shell so
 * it returns a file rather than a page; auth is enforced here.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const url = new URL(request.url);
  const query = parseCustomerQuery(url);
  const customers = await listCustomers(context.db, query);

  const lines = [csvRow(HEADERS)];
  for (const c of customers as CustomerRow[]) {
    const { first, last } = splitName(c.contact_name);
    lines.push(
      csvRow([
        c.email,
        first,
        last,
        c.contact_name,
        c.business_name,
        c.phone,
        c.abn,
        // Keep the address on one CSV line — Mailchimp fields are single-line.
        (c.address ?? "").replace(/\s*\n\s*/g, ", "),
        businessTypeLabel(c.business_type),
        !c.active ? "Deactivated" : c.approved ? "Approved" : "Pending approval",
        c.existing_client ? "Existing client" : "New client",
        c.has_password ? "Yes" : "No",
        c.invited_at ? formatDate(c.invited_at) : "",
        formatDate(c.created_at),
        c.last_login_at ? formatDate(c.last_login_at) : "",
        c.last_order_at
          ? formatDate(c.last_order_at)
          : c.last_order_external
            ? formatDate(c.last_order_external)
            : "",
      ]),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const name = `customers-${query.filter}${query.search ? "-filtered" : ""}-${stamp}.csv`;
  // BOM so Excel opens UTF-8 names (O'Brien, café) correctly.
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
