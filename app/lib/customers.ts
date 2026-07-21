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
