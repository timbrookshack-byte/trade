import type { Env } from "./env";
import { checkManagerCode } from "./auth";
import { bneDate, bneHour, bneToUtcMs, dayOfWeek, fmtDateAU, fmtDuration, fmtTime, workedMinutes } from "./time";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

function greeting(ms: number): string {
  const h = bneHour(ms);
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function arriveMessage(first: string, ms: number): string {
  const dow = dayOfWeek(bneDate(ms));
  const lines = [
    `${greeting(ms)}, ${first}! Great to have you here today. Work safe and enjoy the day.`,
    `Welcome in, ${first}! Thanks for being here — have a safe and productive day.`,
    `Hey ${first}, you're signed in. Lift with your legs, stay hydrated, and have a great day!`,
    `${greeting(ms)}, ${first}! The team's glad you're here. Have a safe one.`,
  ];
  if (dow === 1) lines.push(`Happy Monday, ${first}! Fresh week, fresh start — have a great day.`);
  if (dow === 5) lines.push(`It's Friday, ${first}! Let's finish the week strong — have a great day.`);
  return pick(lines);
}

function finishMessage(first: string, ms: number): string {
  const dow = dayOfWeek(bneDate(ms));
  if (dow === 5 || dow === 6) {
    return pick([
      `Thanks for all your hard work this week, ${first}! Have a fantastic weekend.`,
      `That's a wrap, ${first}! Enjoy your weekend — you've earned it.`,
    ]);
  }
  return pick([
    `Thanks for your hard work today, ${first}! Get home safe.`,
    `Great job today, ${first}. Rest up and see you next time!`,
    `Nice work, ${first}! Thanks for everything today — travel home safely.`,
    `Cheers, ${first}! Appreciate your effort today. Have a great evening.`,
  ]);
}

/** 0412345678 from "0412 345 678", "+61 412 345 678", "61412345678" … */
export function normaliseMobile(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("61") && d.length === 11) d = "0" + d.slice(2);
  if (d.length === 9 && d.startsWith("4")) d = "0" + d;
  return /^04\d{8}$/.test(d) ? d : null;
}

export function fmtMobile(m: string): string {
  return m.length === 10 ? `${m.slice(0, 4)} ${m.slice(4, 7)} ${m.slice(7)}` : m;
}

const clean = (v: unknown, max = 80) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const titleCase = (s: string) => s.replace(/(^|[\s'-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

type Override = { time?: unknown; code?: unknown; reason?: unknown } | undefined;

/** Validates a kiosk "override with manager" request. Returns the overriding instant, or an error response. */
async function resolveOverride(env: Env, ov: Override, workDate: string, now: number): Promise<{ ms: number | null; reason: string } | Response> {
  if (!ov) return { ms: null, reason: "" };
  const reason = clean(ov.reason, 200);
  if (reason.length < 3) return json({ error: "Please give a reason for the change." }, 400);
  const ms = typeof ov.time === "string" ? bneToUtcMs(workDate, ov.time) : null;
  if (ms === null) return json({ error: "Please enter a valid time." }, 400);
  if (ms > now + 60_000) return json({ error: "The time can't be in the future." }, 400);
  const code = await checkManagerCode(env, ov.code);
  if (!code.ok) return json({ error: code.error }, code.status);
  return { ms, reason };
}

export async function listWorkers(env: Env): Promise<Response> {
  const today = bneDate();
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.first_name, w.surname, w.company, s.arrived_at, s.finished_at
       FROM workers w LEFT JOIN shifts s ON s.worker_id = w.id AND s.work_date = ?
      WHERE w.active = 1
      ORDER BY w.first_name COLLATE NOCASE, w.surname COLLATE NOCASE`,
  ).bind(today).all<{ id: number; first_name: string; surname: string; company: string; arrived_at: string | null; finished_at: string | null }>();
  return json({
    today: fmtDateAU(today),
    workers: results.map((w) => ({
      id: w.id,
      first_name: w.first_name,
      surname: w.surname,
      company: w.company,
      status: w.finished_at ? "finished" : w.arrived_at ? "on_site" : "not_arrived",
      arrived: fmtTime(w.arrived_at),
      finished: fmtTime(w.finished_at),
    })),
  });
}

export async function registerWorker(env: Env, body: Record<string, unknown>): Promise<Response> {
  const first = titleCase(clean(body.first_name, 40));
  const surname = titleCase(clean(body.surname, 40));
  const company = clean(body.company, 80);
  const mobile = normaliseMobile(clean(body.mobile, 20));
  if (!first || !surname) return json({ error: "Please enter your first name and surname." }, 400);
  if (!mobile) return json({ error: "Please enter a valid Australian mobile number, e.g. 0412 345 678." }, 400);
  if (!company) return json({ error: "Please enter the contract company you work for." }, 400);
  if (body.inducted !== true) return json({ error: "Please confirm you've been inducted and understand the workplace rules." }, 400);

  const existing = await env.DB.prepare("SELECT id, first_name, surname, active FROM workers WHERE mobile = ?").bind(mobile).first<{ id: number; first_name: string; surname: string; active: number }>();
  if (existing) {
    if (!existing.active) return json({ error: `That mobile is already registered (${existing.first_name} ${existing.surname}) but the account is switched off. Please see ${env.MANAGER_NAME}.` }, 409);
    return json({ error: `You're already registered as ${existing.first_name} ${existing.surname} — just tap your name on the list.`, worker_id: existing.id }, 409);
  }
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    "INSERT INTO workers (first_name, surname, mobile, company, inducted_at, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?) RETURNING id",
  ).bind(first, surname, mobile, company, now, now).first<{ id: number }>();
  return json({ worker: { id: res!.id, first_name: first, surname, company, status: "not_arrived", arrived: "", finished: "" } });
}

async function activeWorker(env: Env, id: unknown) {
  if (typeof id !== "number" || !Number.isInteger(id)) return null;
  return env.DB.prepare("SELECT id, first_name, surname FROM workers WHERE id = ? AND active = 1").bind(id).first<{ id: number; first_name: string; surname: string }>();
}

export async function arrive(env: Env, body: Record<string, unknown>): Promise<Response> {
  const worker = await activeWorker(env, body.worker_id);
  if (!worker) return json({ error: "We couldn't find you on the list — please refresh and try again." }, 404);
  const now = Date.now();
  const today = bneDate(now);

  const shift = await env.DB.prepare("SELECT arrived_at FROM shifts WHERE worker_id = ? AND work_date = ?").bind(worker.id, today).first<{ arrived_at: string }>();
  if (shift) return json({ error: `You're already signed in today (arrived ${fmtTime(shift.arrived_at)}).` }, 409);

  const ov = await resolveOverride(env, body.override as Override, today, now);
  if (ov instanceof Response) return ov;

  const nowIso = new Date(now).toISOString();
  const arrivedIso = ov.ms !== null ? new Date(ov.ms).toISOString() : nowIso;
  const row = await env.DB.prepare(
    "INSERT INTO shifts (worker_id, work_date, arrived_at, arrived_clicked_at, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
  ).bind(worker.id, today, arrivedIso, nowIso, nowIso).first<{ id: number }>();
  if (ov.ms !== null) {
    await env.DB.prepare(
      "INSERT INTO adjustments (shift_id, worker_id, work_date, field, old_value, new_value, reason, source, created_at) VALUES (?, ?, ?, 'arrived_at', ?, ?, ?, 'kiosk_override', ?)",
    ).bind(row!.id, worker.id, today, nowIso, arrivedIso, ov.reason, nowIso).run();
  }

  // Gentle nudge if a previous day was never signed out.
  const open = await env.DB.prepare("SELECT work_date FROM shifts WHERE worker_id = ? AND work_date < ? AND finished_at IS NULL ORDER BY work_date DESC LIMIT 1").bind(worker.id, today).first<{ work_date: string }>();

  return json({
    title: `You're signed in at ${fmtTime(arrivedIso)}`,
    message: arriveMessage(worker.first_name, now),
    note: open ? `Heads up: you didn't sign out on ${fmtDateAU(open.work_date)}. Please let ${env.MANAGER_NAME} know your finish time.` : undefined,
  });
}

export async function finish(env: Env, body: Record<string, unknown>): Promise<Response> {
  const worker = await activeWorker(env, body.worker_id);
  if (!worker) return json({ error: "We couldn't find you on the list — please refresh and try again." }, 404);
  const now = Date.now();
  const today = bneDate(now);

  const shift = await env.DB.prepare("SELECT id, arrived_at, finished_at FROM shifts WHERE worker_id = ? AND work_date = ?").bind(worker.id, today).first<{ id: number; arrived_at: string; finished_at: string | null }>();
  if (!shift) return json({ error: `You haven't signed in today. Please see ${env.MANAGER_NAME} to record your hours.` }, 409);
  if (shift.finished_at) return json({ error: `You've already finished for the day (${fmtTime(shift.finished_at)}).` }, 409);

  if (typeof body.break_taken !== "boolean") return json({ error: "Please tell us if you had a break." }, 400);
  const breakMins = body.break_taken ? Number(body.break_minutes) : 0;
  if (body.break_taken && (!Number.isInteger(breakMins) || breakMins < 1 || breakMins > 240)) {
    return json({ error: "Please choose how long your break was." }, 400);
  }

  const ov = await resolveOverride(env, body.override as Override, today, now);
  if (ov instanceof Response) return ov;

  const nowIso = new Date(now).toISOString();
  const finishedIso = ov.ms !== null ? new Date(ov.ms).toISOString() : nowIso;
  if (Date.parse(finishedIso) <= Date.parse(shift.arrived_at)) {
    return json({ error: `The finish time must be after your arrival (${fmtTime(shift.arrived_at)}).` }, 400);
  }
  const span = Math.round((Date.parse(finishedIso) - Date.parse(shift.arrived_at)) / 60_000);
  if (breakMins >= span) return json({ error: "Your break can't be longer than your time on site." }, 400);

  await env.DB.prepare("UPDATE shifts SET finished_at = ?, finished_clicked_at = ?, break_taken = ?, break_minutes = ? WHERE id = ?")
    .bind(finishedIso, nowIso, body.break_taken ? 1 : 0, breakMins, shift.id).run();
  if (ov.ms !== null) {
    await env.DB.prepare(
      "INSERT INTO adjustments (shift_id, worker_id, work_date, field, old_value, new_value, reason, source, created_at) VALUES (?, ?, ?, 'finished_at', ?, ?, ?, 'kiosk_override', ?)",
    ).bind(shift.id, worker.id, today, nowIso, finishedIso, ov.reason, nowIso).run();
  }

  const worked = workedMinutes(shift.arrived_at, finishedIso, breakMins)!;
  return json({
    title: `Signed out at ${fmtTime(finishedIso)}`,
    message: finishMessage(worker.first_name, now),
    summary: `Today: ${fmtTime(shift.arrived_at)} – ${fmtTime(finishedIso)}, ${breakMins ? `${breakMins} min break` : "no break"} · ${fmtDuration(worked)} worked.`,
  });
}
