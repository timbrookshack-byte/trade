import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const BRISBANE = "Australia/Brisbane";

export function formatDate(value: string | Date, opts?: Intl.DateTimeFormatOptions) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: BRISBANE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...opts,
  }).format(date);
}

export function formatDateTime(value: string | Date) {
  return formatDate(value, { hour: "numeric", minute: "2-digit", hour12: true });
}

export function formatCurrency(amountIncGst: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(amountIncGst);
}

/** Prices are stored inc-GST; ex-GST is always derived (see CLAUDE.md). */
export function exGst(incGst: number) {
  return incGst / 1.1;
}
