// Shared customer types/constants — safe for client components.

export type BusinessType =
  | "retailer"
  | "interior_designer"
  | "commercial"
  | "hospitality"
  | "other";

export const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: "retailer", label: "Furniture / homewares retailer" },
  { value: "interior_designer", label: "Interior designer / decorator" },
  { value: "commercial", label: "Commercial / office fit-out" },
  { value: "hospitality", label: "Hospitality / accommodation" },
  { value: "other", label: "Other trade business" },
];

export function businessTypeLabel(value: string) {
  return BUSINESS_TYPES.find((t) => t.value === value)?.label ?? value;
}

/** Customer list filters, shared by the admin list page and the CSV export. */
export const CUSTOMER_FILTERS = [
  { key: "pending", label: "Pending approval" },
  { key: "approved", label: "Approved" },
  { key: "new", label: "New clients" },
  { key: "all", label: "All" },
] as const;

export type CustomerFilter = (typeof CUSTOMER_FILTERS)[number]["key"];

/** Query string that reproduces a list view (used by links and the export). */
export function customerQueryString(opts: {
  filter: string;
  sort: string;
  dir: string;
  search: string;
}) {
  const params = new URLSearchParams({ filter: opts.filter, sort: opts.sort, dir: opts.dir });
  if (opts.search) params.set("q", opts.search);
  return params.toString();
}
