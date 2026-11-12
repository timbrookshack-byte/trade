import type { Env } from "./env";
import { fmtMobile } from "./kiosk";
import { addDays, bneDate, DAY_NAMES, dayOfWeek, decimalHours, fmtDateAU, fmtDuration, fmtTime, weekStart, workedMinutes } from "./time";

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type DayCell = {
  shift_id: number;
  arrived_at: string;
  finished_at: string | null;
  break_minutes: number;
  worked: number | null;
  overridden: boolean;
};

export type WorkerWeek = {
  worker_id: number;
  first_name: string;
  surname: string;
  mobile: string;
  company: string;
  days: (DayCell | null)[]; // Mon..Sun
  total: number;
  missingFinish: number;
};

export type Adjustment = { work_date: string; name: string; field: string; old_value: string | null; new_value: string | null; reason: string; source: string; created_at: string };

export type WeekData = { start: string; dates: string[]; companies: { company: string; workers: WorkerWeek[]; total: number }[]; adjustments: Adjustment[]; grandTotal: number };

export async function loadWeek(env: Env, start: string): Promise<WeekData> {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const end = dates[6];
  const { results: shifts } = await env.DB.prepare(
    `SELECT s.id, s.worker_id, s.work_date, s.arrived_at, s.finished_at, s.break_minutes,
            w.first_name, w.surname, w.mobile, w.company,
            EXISTS (SELECT 1 FROM adjustments a WHERE a.shift_id = s.id) AS overridden
       FROM shifts s JOIN workers w ON w.id = s.worker_id
      WHERE s.work_date BETWEEN ? AND ?`,
  ).bind(start, end).all<{ id: number; worker_id: number; work_date: string; arrived_at: string; finished_at: string | null; break_minutes: number; first_name: string; surname: string; mobile: string; company: string; overridden: number }>();

  const byWorker = new Map<number, WorkerWeek>();
  for (const s of shifts) {
    let w = byWorker.get(s.worker_id);
    if (!w) {
      w = { worker_id: s.worker_id, first_name: s.first_name, surname: s.surname, mobile: s.mobile, company: s.company, days: Array(7).fill(null), total: 0, missingFinish: 0 };
      byWorker.set(s.worker_id, w);
    }
    const worked = workedMinutes(s.arrived_at, s.finished_at, s.break_minutes);
    w.days[dates.indexOf(s.work_date)] = { shift_id: s.id, arrived_at: s.arrived_at, finished_at: s.finished_at, break_minutes: s.break_minutes, worked, overridden: !!s.overridden };
    if (worked === null) w.missingFinish++;
    else w.total += worked;
  }

  const groups = new Map<string, WorkerWeek[]>();
  for (const w of byWorker.values()) {
    const key = w.company.trim();
    const match = [...groups.keys()].find((k) => k.toLowerCase() === key.toLowerCase()) ?? key;
    groups.set(match, [...(groups.get(match) ?? []), w]);
  }
  const companies = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([company, workers]) => ({
      company,
      workers: workers.sort((a, b) => `${a.first_name} ${a.surname}`.localeCompare(`${b.first_name} ${b.surname}`)),
      total: workers.reduce((t, w) => t + w.total, 0),
    }));

  const { results: adjustments } = await env.DB.prepare(
    `SELECT a.work_date, w.first_name || ' ' || w.surname AS name, a.field, a.old_value, a.new_value, a.reason, a.source, a.created_at
       FROM adjustments a JOIN workers w ON w.id = a.worker_id
      WHERE a.work_date BETWEEN ? AND ? ORDER BY a.work_date, a.created_at`,
  ).bind(start, end).all<Adjustment>();

  return { start, dates, companies, adjustments, grandTotal: companies.reduce((t, c) => t + c.total, 0) };
}

/** The week before the one containing today (Brisbane) — what Monday's email reports on. */
export function previousWeekStart(ms = Date.now()): string {
  return addDays(weekStart(bneDate(ms)), -7);
}

const TH = "padding:6px 8px;border-bottom:2px solid #111;text-align:left;font-size:12px;white-space:nowrap";
const TD = "padding:6px 8px;border-bottom:1px solid #e5e5e5;font-size:12px;vertical-align:top;white-space:nowrap";

export function weekLabel(d: WeekData): string {
  return `${DAY_NAMES[dayOfWeek(d.dates[0])]} ${fmtDateAU(d.dates[0])} – ${DAY_NAMES[dayOfWeek(d.dates[6])]} ${fmtDateAU(d.dates[6])}`;
}

function fieldLabel(f: string): string {
  return ({ arrived_at: "Arrival", finished_at: "Finish", break_minutes: "Break", created: "Shift added", deleted: "Shift deleted" } as Record<string, string>)[f] ?? f;
}

function adjValue(field: string, v: string | null): string {
  if (v === null || v === "") return "—";
  if (field === "arrived_at" || field === "finished_at") return fmtTime(v);
  if (field === "break_minutes") return `${v} min`;
  return v;
}

/**
 * Week table with inline styles so the same markup works in the email and the
 * manager page. `link(cell, worker, date)` wraps cells in edit links (admin only).
 */
export function renderWeek(d: WeekData, link?: (shiftId: number | null, workerId: number, date: string) => string): string {
  if (d.companies.length === 0) return `<p style="font-size:14px;color:#555">No sign-ins recorded for this week.</p>`;
  const head = `<tr><th style="${TH}">Worker</th>${d.dates.map((dt) => `<th style="${TH}">${DAY_NAMES[dayOfWeek(dt)]}<br><span style="font-weight:normal;color:#666">${fmtDateAU(dt).slice(0, 5)}</span></th>`).join("")}<th style="${TH};text-align:right">Total</th></tr>`;

  const sections = d.companies.map((c) => {
    const rows = c.workers.map((w) => {
      const cells = w.days.map((cell, i) => {
        let inner: string;
        if (!cell) inner = `<span style="color:#bbb">—</span>`;
        else {
          const fin = cell.finished_at ? fmtTime(cell.finished_at) : `<span style="color:#c00;font-weight:bold">no sign-out</span>`;
          inner = `${fmtTime(cell.arrived_at)} – ${fin}<br><span style="color:#666">${cell.break_minutes ? `${cell.break_minutes}m break` : "no break"}${cell.worked !== null ? ` · <b style="color:#111">${fmtDuration(cell.worked)}</b>` : ""}</span>${cell.overridden ? `<br><span style="color:#a21caf;font-weight:bold">⚑ manager override</span>` : ""}`;
        }
        if (link) inner = `<a href="${link(cell?.shift_id ?? null, w.worker_id, d.dates[i])}" style="color:inherit;text-decoration:none;display:block">${inner}</a>`;
        return `<td style="${TD}${cell && !cell.finished_at ? ";background:#fff1f1" : ""}">${inner}</td>`;
      }).join("");
      return `<tr><td style="${TD}"><b>${esc(w.first_name)} ${esc(w.surname)}</b><br><span style="color:#666">${esc(fmtMobile(w.mobile))}</span></td>${cells}<td style="${TD};text-align:right"><b>${fmtDuration(w.total)}</b><br><span style="color:#666">${decimalHours(w.total)} hrs</span>${w.missingFinish ? `<br><span style="color:#c00">+${w.missingFinish} without sign-out</span>` : ""}</td></tr>`;
    }).join("");
    return `<h3 style="font-size:15px;margin:22px 0 6px">${esc(c.company)} <span style="font-weight:normal;color:#666">— ${fmtDuration(c.total)} (${decimalHours(c.total)} hrs)</span></h3>
<table style="border-collapse:collapse;width:100%;font-family:inherit">${head}${rows}</table>`;
  }).join("");

  const audit = d.adjustments.length
    ? `<h3 style="font-size:15px;margin:26px 0 6px">Manager overrides &amp; edits</h3>
<table style="border-collapse:collapse;width:100%"><tr><th style="${TH}">Date</th><th style="${TH}">Worker</th><th style="${TH}">Change</th><th style="${TH}">Reason</th></tr>${d.adjustments
        .map((a) => `<tr><td style="${TD}">${fmtDateAU(a.work_date)}</td><td style="${TD}">${esc(a.name)}</td><td style="${TD}">${fieldLabel(a.field)}: ${esc(adjValue(a.field, a.old_value))} → ${esc(adjValue(a.field, a.new_value))}${a.source === "kiosk_override" ? " (at kiosk)" : ""}</td><td style="${TD};white-space:normal">${esc(a.reason)}</td></tr>`)
        .join("")}</table>`
    : "";

  return `${sections}${audit}`;
}

export function weekCsv(d: WeekData): string {
  const q = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [["Company", "First name", "Surname", "Mobile", "Date", "Day", "Arrived", "Finished", "Break (mins)", "Hours worked", "Manager override"].join(",")];
  for (const c of d.companies)
    for (const w of c.workers)
      w.days.forEach((cell, i) => {
        if (!cell) return;
        lines.push([c.company, w.first_name, w.surname, fmtMobile(w.mobile), fmtDateAU(d.dates[i]), DAY_NAMES[dayOfWeek(d.dates[i])], fmtTime(cell.arrived_at), cell.finished_at ? fmtTime(cell.finished_at) : "NO SIGN-OUT", cell.break_minutes, cell.worked !== null ? decimalHours(cell.worked) : "", cell.overridden ? "Yes" : ""].map(q).join(","));
      });
  return lines.join("\r\n") + "\r\n";
}

function emailHtml(d: WeekData): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;max-width:1000px">
<h2 style="margin:0 0 4px">Contractor hours — week of ${weekLabel(d)}</h2>
<p style="margin:0 0 4px;color:#444;font-size:14px">Total on site: <b>${fmtDuration(d.grandTotal)}</b> (${decimalHours(d.grandTotal)} hrs) across ${d.companies.reduce((n, c) => n + c.workers.length, 0)} workers. Hours = sign-out − sign-in − break.</p>
<p style="margin:0 0 12px;color:#666;font-size:12px">Compare these against the timesheets the contract companies submit. A CSV copy is attached.</p>
${renderWeek(d)}
<p style="margin-top:24px;color:#888;font-size:11px">Sent automatically every Monday at 5:00am by The Furniture Shack sign-in kiosk.</p></div>`;
}

/** Sends the weekly summary. Cron runs are skipped if that week was already sent. */
export async function sendSummary(env: Env, start: string, trigger: "cron" | "manual"): Promise<{ ok: boolean; detail: string }> {
  if (trigger === "cron") {
    const done = await env.DB.prepare("SELECT 1 FROM summary_runs WHERE week_start = ? AND ok = 1").bind(start).first();
    if (done) return { ok: true, detail: "already sent" };
  }
  const d = await loadWeek(env, start);
  const to = env.SUMMARY_TO.split(",").map((s) => s.trim()).filter(Boolean);
  let ok = false;
  let detail: string;
  if (!env.RESEND_API_KEY) {
    detail = "RESEND_API_KEY not set — email skipped";
  } else {
    const csv = weekCsv(d);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to,
        subject: `Contractor hours — week of ${fmtDateAU(d.dates[0])} (${decimalHours(d.grandTotal)} hrs)`,
        html: emailHtml(d),
        attachments: [{ filename: `contractor-hours-${start}.csv`, content: btoa(unescape(encodeURIComponent(csv))) }],
      }),
    });
    ok = res.ok;
    detail = ok ? `sent to ${to.join(", ")}` : `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`;
  }
  await env.DB.prepare("INSERT INTO summary_runs (week_start, sent_at, ok, detail, trigger) VALUES (?, ?, ?, ?, ?)").bind(start, new Date().toISOString(), ok ? 1 : 0, detail, trigger).run();
  if (!ok) console.error("weekly summary:", detail);
  return { ok, detail };
}
