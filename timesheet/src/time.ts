// Australia/Brisbane is UTC+10 all year (no daylight saving), so a fixed
// offset is exact and avoids Intl timezone quirks on Workers.
const OFFSET_MS = 10 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function shifted(ms: number): Date {
  return new Date(ms + OFFSET_MS);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Brisbane calendar date (YYYY-MM-DD) for a UTC instant. */
export function bneDate(ms: number = Date.now()): string {
  const d = shifted(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Brisbane HH:MM (24h) for a UTC instant — used to prefill time inputs. */
export function bneHHMM(ms: number): string {
  const d = shifted(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function bneHour(ms: number = Date.now()): number {
  return shifted(ms).getUTCHours();
}

/** "7:05am" */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = shifted(Date.parse(iso));
  let h = d.getUTCHours();
  const suffix = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${pad(d.getUTCMinutes())}${suffix}`;
}

/** YYYY-MM-DD → DD/MM/YYYY */
export function fmtDateAU(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

function ymdToUtcMidnight(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function isYmd(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(ymdToUtcMidnight(s));
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(ymdToUtcMidnight(ymd) + n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function dayOfWeek(ymd: string): number {
  return new Date(ymdToUtcMidnight(ymd)).getUTCDay();
}

/** Monday of the week containing ymd. */
export function weekStart(ymd: string): string {
  const dow = dayOfWeek(ymd);
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}

/** Brisbane local date + "HH:MM" → UTC epoch ms. */
export function bneToUtcMs(ymd: string, hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return ymdToUtcMidnight(ymd) + h * 3600_000 + min * 60_000 - OFFSET_MS;
}

/** 465 → "7h 45m" */
export function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${pad(m)}m`;
}

/** 465 → "7.75" (decimal hours, for CSV / comparing against contractor invoices) */
export function decimalHours(mins: number): string {
  return (mins / 60).toFixed(2);
}

/** Minutes worked for a completed shift (span − break), never negative. */
export function workedMinutes(arrivedIso: string, finishedIso: string | null, breakMins: number): number | null {
  if (!finishedIso) return null;
  const span = Math.round((Date.parse(finishedIso) - Date.parse(arrivedIso)) / 60_000);
  return Math.max(0, span - (breakMins || 0));
}
