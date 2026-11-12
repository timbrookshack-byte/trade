import type { Env } from "./env";
import { ADMIN_MAX_AGE, checkManagerCode, clearCookie, hasCookie, makeCookie } from "./auth";
import { fmtMobile, normaliseMobile } from "./kiosk";
import { page } from "./pages";
import { esc, loadWeek, renderWeek, sendSummary, weekCsv, weekLabel } from "./summary";
import { addDays, bneDate, bneHHMM, bneToUtcMs, fmtDateAU, fmtTime, isYmd, weekStart } from "./time";

const ADMIN_CSS = `<style>
nav{background:#111;color:#fff;padding:12px 24px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
nav b{margin-right:auto}nav a,nav button{color:#ddd;text-decoration:none;background:none;border:0;cursor:pointer;font-size:15px;padding:0}
nav a:hover,nav button:hover{color:#fff}
.wrap{max-width:1280px;margin:0 auto;padding:20px 24px 60px}
.box{background:#fff;border-radius:14px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.05);overflow-x:auto}
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
.bar h1{margin:0;font-size:22px;margin-right:auto}
.flash{background:#dcfce7;color:#15803d;padding:10px 14px;border-radius:10px;margin-bottom:14px;font-weight:600}
.flash.bad{background:#fee2e2;color:#b91c1c}
table.list{border-collapse:collapse;width:100%}table.list th,table.list td{padding:8px;border-bottom:1px solid #eee;text-align:left;font-size:14px}
.muted{color:#666;font-size:13px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
</style>`;

function shell(title: string, content: string, flash?: { msg: string; bad?: boolean }): Response {
  return page(`${title} — Timesheets`, `<nav><b>Contractor timesheets</b><a href="/admin">Weekly hours</a><a href="/admin/workers">Workers</a><a href="/" target="_blank">Kiosk</a><form method="post" action="/admin/logout" style="margin:0"><button>Log out</button></form></nav>
<div class="wrap">${flash ? `<div class="flash${flash.bad ? " bad" : ""}">${esc(flash.msg)}</div>` : ""}${content}</div>`, ADMIN_CSS);
}

const redirect = (to: string, cookie?: string) => new Response(null, { status: 303, headers: { Location: to, ...(cookie ? { "Set-Cookie": cookie } : {}) } });

function loginPage(managerName: string, error = ""): Response {
  return page("Manager login — Timesheets", `<div style="max-width:420px;margin:12vh auto;padding:0 16px"><div style="background:#fff;border-radius:18px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,.06)">
<h1 style="margin:0 0 6px;font-size:24px">Manager area</h1><p style="color:#666;margin:0">Contractor hours, edits and the weekly summary.</p>
<form method="post" action="/admin/login"><label for="code">Manager code (${esc(managerName)})</label><input id="code" name="code" type="password" inputmode="numeric" autocomplete="off" required autofocus>
<div class="err">${esc(error)}</div><button class="btn" style="width:100%;margin-top:8px">Log in</button></form></div></div>`);
}

export async function handleAdmin(req: Request, env: Env, url: URL): Promise<Response> {
  const p = url.pathname;
  const post = req.method === "POST";

  if (p === "/admin/login" && post) {
    const form = await req.formData();
    const res = await checkManagerCode(env, form.get("code"));
    if (!res.ok) return loginPage(env.MANAGER_NAME, res.error);
    return redirect("/admin", await makeCookie(env, "admin", ADMIN_MAX_AGE));
  }
  if (p === "/admin/logout" && post) return redirect("/admin", clearCookie("admin"));

  if (!(await hasCookie(req, env, "admin"))) {
    return req.method === "GET" ? loginPage(env.MANAGER_NAME) : redirect("/admin");
  }

  const weekParam = url.searchParams.get("week");
  const week = weekStart(isYmd(weekParam) ? weekParam : bneDate());

  if (p === "/admin" || p === "/admin/") return weekPage(env, week, url.searchParams.get("msg"), url.searchParams.get("bad") === "1");

  if (p === "/admin/export.csv") {
    const d = await loadWeek(env, week);
    return new Response(weekCsv(d), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="contractor-hours-${week}.csv"` } });
  }

  if (p === "/admin/send-summary" && post) {
    const r = await sendSummary(env, week, "manual");
    return redirect(`/admin?week=${week}&msg=${encodeURIComponent(r.ok ? `Summary emailed (${r.detail}).` : `Email failed: ${r.detail}`)}${r.ok ? "" : "&bad=1"}`);
  }

  if (p === "/admin/shift") return post ? saveShift(env, await req.formData()) : shiftPage(env, url);

  if (p === "/admin/workers") return workersPage(env, url.searchParams.get("msg"));
  const wm = /^\/admin\/workers\/(\d+)$/.exec(p);
  if (wm) return post ? saveWorker(env, Number(wm[1]), await req.formData()) : workerPage(env, Number(wm[1]));

  return new Response("Not found", { status: 404 });
}

async function weekPage(env: Env, week: string, msg: string | null, bad: boolean): Promise<Response> {
  const d = await loadWeek(env, week);
  const last = await env.DB.prepare("SELECT sent_at, ok, detail FROM summary_runs WHERE week_start = ? ORDER BY id DESC LIMIT 1").bind(week).first<{ sent_at: string; ok: number; detail: string }>();
  const thisWeek = weekStart(bneDate());
  const totalWorkers = d.companies.reduce((n, c) => n + c.workers.length, 0);
  const content = `<div class="bar"><h1>Week of ${weekLabel(d)}</h1>
<a class="btn sm ghost" href="/admin?week=${addDays(week, -7)}">← Previous</a>${week !== thisWeek ? `<a class="btn sm ghost" href="/admin">This week</a>` : ""}<a class="btn sm ghost" href="/admin?week=${addDays(week, 7)}">Next →</a>
<a class="btn sm" href="/admin/export.csv?week=${week}">Download CSV</a>
<form method="post" action="/admin/send-summary?week=${week}" style="margin:0" onsubmit="return confirm('Email this week\\'s summary to ${esc(env.SUMMARY_TO)}?')"><button class="btn sm brand">Email summary</button></form></div>
<p class="muted" style="margin:-6px 0 14px">Total <b>${(d.grandTotal / 60).toFixed(2)} hrs</b> · ${totalWorkers} workers · Click any day to correct it or add a missed shift (every change is logged with a reason). The summary emails automatically every Monday 5:00am to ${esc(env.SUMMARY_TO)}${last ? ` · last sent for this week ${fmtDateAU(bneDate(Date.parse(last.sent_at)))} ${fmtTime(last.sent_at)} — ${last.ok ? "OK" : `failed: ${esc(last.detail)}`}` : ""}.</p>
<div class="box">${renderWeek(d, (id, workerId, date) => (id ? `/admin/shift?id=${id}` : `/admin/shift?worker=${workerId}&date=${date}`))}</div>
<p class="muted" style="margin-top:14px">Missing someone? Workers with no shifts this week aren't listed — add a shift from <a href="/admin/workers">Workers</a>.</p>`;
  return shell("Weekly hours", content, msg ? { msg, bad } : undefined);
}

type ShiftRow = { id: number; worker_id: number; work_date: string; arrived_at: string; finished_at: string | null; break_minutes: number; arrived_clicked_at: string; finished_clicked_at: string | null };

async function shiftPage(env: Env, url: URL, error = ""): Promise<Response> {
  const id = Number(url.searchParams.get("id"));
  let shift: ShiftRow | null = null;
  let workerId = Number(url.searchParams.get("worker"));
  let date = url.searchParams.get("date") ?? "";
  if (id) {
    shift = await env.DB.prepare("SELECT * FROM shifts WHERE id = ?").bind(id).first<ShiftRow>();
    if (!shift) return redirect("/admin");
    workerId = shift.worker_id;
    date = shift.work_date;
  }
  if (!isYmd(date)) date = bneDate();
  const worker = await env.DB.prepare("SELECT id, first_name, surname, company FROM workers WHERE id = ?").bind(workerId).first<{ id: number; first_name: string; surname: string; company: string }>();
  if (!worker) return redirect("/admin");

  const { results: history } = shift
    ? await env.DB.prepare("SELECT field, old_value, new_value, reason, source, created_at FROM adjustments WHERE shift_id = ? ORDER BY id").bind(shift.id).all<{ field: string; old_value: string | null; new_value: string | null; reason: string; source: string; created_at: string }>()
    : { results: [] };
  const t = (iso: string | null) => (iso ? bneHHMM(Date.parse(iso)) : "");
  const hv = (field: string, v: string | null) => (v === null || v === "" ? "—" : field.endsWith("_at") ? fmtTime(v) : v);

  const content = `<div class="bar"><h1>${shift ? "Edit" : "Add"} shift — ${esc(worker.first_name)} ${esc(worker.surname)}</h1><a class="btn sm ghost" href="/admin?week=${weekStart(date)}">← Back to week</a></div>
<div class="box" style="max-width:640px"><p class="muted" style="margin-top:0">${esc(worker.company)}${shift ? ` · button pressed: in ${fmtTime(shift.arrived_clicked_at)}${shift.finished_clicked_at ? `, out ${fmtTime(shift.finished_clicked_at)}` : ""}` : ""}</p>
<form method="post" action="/admin/shift">
<input type="hidden" name="id" value="${shift?.id ?? ""}"><input type="hidden" name="worker" value="${worker.id}">
<div class="grid2"><div><label>Date</label><input type="date" name="date" value="${date}" ${shift ? "readonly" : "required"}></div><div></div>
<div><label>Arrived</label><input type="time" name="arrived" value="${t(shift?.arrived_at ?? null)}" required></div>
<div><label>Finished <span class="muted">(blank = not signed out)</span></label><input type="time" name="finished" value="${t(shift?.finished_at ?? null)}"></div>
<div><label>Break (minutes)</label><input type="number" name="break" min="0" max="240" value="${shift?.break_minutes ?? 0}"></div><div></div></div>
<label>Reason for the change</label><input type="text" name="reason" required maxlength="200" placeholder="e.g. Forgot to sign out — confirmed with supervisor">
${shift ? `<label class="check" style="font-weight:500"><input type="checkbox" name="delete" value="1" style="width:20px;height:20px"> Delete this shift entirely (e.g. wrong person tapped)</label>` : ""}
<div class="err">${esc(error)}</div><button class="btn" style="margin-top:8px">Save</button></form>
${history.length ? `<h3 style="margin-top:26px">History</h3><table class="list"><tr><th>When</th><th>Change</th><th>Reason</th></tr>${history.map((a) => `<tr><td>${fmtDateAU(bneDate(Date.parse(a.created_at)))} ${fmtTime(a.created_at)}</td><td>${esc(a.field)}: ${esc(hv(a.field, a.old_value))} → ${esc(hv(a.field, a.new_value))}${a.source === "kiosk_override" ? " (kiosk override)" : ""}</td><td>${esc(a.reason)}</td></tr>`).join("")}</table>` : ""}
</div>`;
  return shell("Shift", content);
}

async function saveShift(env: Env, form: FormData): Promise<Response> {
  const id = Number(form.get("id")) || null;
  const workerId = Number(form.get("worker"));
  const reason = String(form.get("reason") ?? "").trim().slice(0, 200);
  const back = (msg: string) => shiftPage(env, new URL(`http://x/admin/shift?${id ? `id=${id}` : `worker=${workerId}&date=${form.get("date")}`}`), msg);
  if (reason.length < 3) return back("Please give a reason for the change.");
  const nowIso = new Date().toISOString();

  const existing = id ? await env.DB.prepare("SELECT * FROM shifts WHERE id = ?").bind(id).first<ShiftRow>() : null;
  if (id && !existing) return redirect("/admin");
  const date = existing ? existing.work_date : String(form.get("date") ?? "");
  if (!isYmd(date)) return back("Please choose a date.");
  const log = (shiftId: number, field: string, oldV: string | null, newV: string | null) =>
    env.DB.prepare("INSERT INTO adjustments (shift_id, worker_id, work_date, field, old_value, new_value, reason, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'admin_edit', ?)").bind(shiftId, workerId, date, field, oldV, newV, reason, nowIso);

  if (existing && form.get("delete") === "1") {
    await env.DB.batch([env.DB.prepare("DELETE FROM shifts WHERE id = ?").bind(existing.id), log(existing.id, "deleted", `${fmtTime(existing.arrived_at)}–${fmtTime(existing.finished_at) || "?"}`, null)]);
    return redirect(`/admin?week=${weekStart(date)}&msg=${encodeURIComponent("Shift deleted.")}`);
  }

  const arrivedMs = bneToUtcMs(date, String(form.get("arrived") ?? ""));
  if (arrivedMs === null) return back("Please enter the arrival time.");
  const finRaw = String(form.get("finished") ?? "").trim();
  const finishedMs = finRaw ? bneToUtcMs(date, finRaw) : null;
  if (finRaw && finishedMs === null) return back("That finish time isn't valid.");
  if (finishedMs !== null && finishedMs <= arrivedMs) return back("Finish must be after arrival.");
  const brk = Math.max(0, Math.min(240, Math.round(Number(form.get("break")) || 0)));
  if (finishedMs !== null && brk >= (finishedMs - arrivedMs) / 60_000) return back("The break can't be longer than the shift.");

  // The form only has minute precision: an untouched HH:MM keeps the original (to-the-second) timestamp.
  const sameMinute = (iso: string | null, ms: number | null) => iso !== null && ms !== null && bneHHMM(Date.parse(iso)) === bneHHMM(ms);
  const arrivedIso = existing && sameMinute(existing.arrived_at, arrivedMs) ? existing.arrived_at : new Date(arrivedMs).toISOString();
  const finishedIso = finishedMs === null ? null : existing && sameMinute(existing.finished_at, finishedMs) ? existing.finished_at : new Date(finishedMs).toISOString();

  if (!existing) {
    const dup = await env.DB.prepare("SELECT id FROM shifts WHERE worker_id = ? AND work_date = ?").bind(workerId, date).first<{ id: number }>();
    if (dup) return redirect(`/admin/shift?id=${dup.id}`);
    const row = await env.DB.prepare(
      "INSERT INTO shifts (worker_id, work_date, arrived_at, arrived_clicked_at, finished_at, finished_clicked_at, break_taken, break_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    ).bind(workerId, date, arrivedIso, nowIso, finishedIso, finishedIso ? nowIso : null, finishedIso ? (brk > 0 ? 1 : 0) : null, brk, nowIso).first<{ id: number }>();
    await log(row!.id, "created", null, `${fmtTime(arrivedIso)}–${fmtTime(finishedIso) || "?"}${brk ? `, ${brk}m break` : ""}`).run();
    return redirect(`/admin?week=${weekStart(date)}&msg=${encodeURIComponent("Shift added.")}`);
  }

  const stmts: D1PreparedStatement[] = [];
  if (arrivedIso !== existing.arrived_at) stmts.push(log(existing.id, "arrived_at", existing.arrived_at, arrivedIso));
  if (finishedIso !== existing.finished_at) stmts.push(log(existing.id, "finished_at", existing.finished_at, finishedIso));
  if (brk !== existing.break_minutes) stmts.push(log(existing.id, "break_minutes", String(existing.break_minutes), String(brk)));
  if (!stmts.length) return redirect(`/admin?week=${weekStart(date)}&msg=${encodeURIComponent("No changes.")}`);
  stmts.push(env.DB.prepare("UPDATE shifts SET arrived_at = ?, finished_at = ?, finished_clicked_at = COALESCE(finished_clicked_at, CASE WHEN ? IS NULL THEN NULL ELSE ? END), break_minutes = ?, break_taken = CASE WHEN ? > 0 THEN 1 ELSE COALESCE(break_taken, 0) END WHERE id = ?")
    .bind(arrivedIso, finishedIso, finishedIso, nowIso, brk, brk, existing.id));
  await env.DB.batch(stmts);
  return redirect(`/admin?week=${weekStart(date)}&msg=${encodeURIComponent("Shift updated.")}`);
}

async function workersPage(env: Env, msg: string | null): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT w.*, (SELECT MAX(work_date) FROM shifts s WHERE s.worker_id = w.id) AS last_seen
       FROM workers w ORDER BY w.active DESC, w.company COLLATE NOCASE, w.first_name COLLATE NOCASE`,
  ).all<{ id: number; first_name: string; surname: string; mobile: string; company: string; inducted_at: string; active: number; last_seen: string | null }>();
  const today = bneDate();
  const content = `<div class="bar"><h1>Workers</h1></div><div class="box"><table class="list"><tr><th>Name</th><th>Company</th><th>Mobile</th><th>Inducted</th><th>Last on site</th><th></th></tr>
${results.map((w) => `<tr style="${w.active ? "" : "opacity:.5"}"><td><b>${esc(w.first_name)} ${esc(w.surname)}</b>${w.active ? "" : " <span class='muted'>(hidden from kiosk)</span>"}</td><td>${esc(w.company)}</td><td>${esc(fmtMobile(w.mobile))}</td><td>${fmtDateAU(bneDate(Date.parse(w.inducted_at)))}</td><td>${w.last_seen ? fmtDateAU(w.last_seen) : "—"}</td>
<td style="white-space:nowrap"><a class="btn sm ghost" href="/admin/workers/${w.id}">Edit</a> <a class="btn sm ghost" href="/admin/shift?worker=${w.id}&date=${today}">Add shift</a></td></tr>`).join("") || `<tr><td colspan="6" class="muted">No workers yet — they register themselves at the kiosk.</td></tr>`}
</table></div>`;
  return shell("Workers", content, msg ? { msg } : undefined);
}

async function workerPage(env: Env, id: number, error = ""): Promise<Response> {
  const w = await env.DB.prepare("SELECT * FROM workers WHERE id = ?").bind(id).first<{ id: number; first_name: string; surname: string; mobile: string; company: string; active: number; inducted_at: string }>();
  if (!w) return redirect("/admin/workers");
  const content = `<div class="bar"><h1>${esc(w.first_name)} ${esc(w.surname)}</h1><a class="btn sm ghost" href="/admin/workers">← Workers</a></div>
<div class="box" style="max-width:640px"><p class="muted" style="margin-top:0">Registered &amp; confirmed induction ${fmtDateAU(bneDate(Date.parse(w.inducted_at)))} ${fmtTime(w.inducted_at)}.</p>
<form method="post"><div class="grid2"><div><label>First name</label><input type="text" name="first_name" value="${esc(w.first_name)}" required></div><div><label>Surname</label><input type="text" name="surname" value="${esc(w.surname)}" required></div>
<div><label>Mobile</label><input type="tel" name="mobile" value="${esc(fmtMobile(w.mobile))}" required></div><div><label>Contract company</label><input type="text" name="company" value="${esc(w.company)}" required></div></div>
<label class="check" style="font-weight:500"><input type="checkbox" name="active" value="1" ${w.active ? "checked" : ""} style="width:20px;height:20px"> Show on the kiosk (untick for people who no longer work here — their hours are kept)</label>
<div class="err">${esc(error)}</div><button class="btn" style="margin-top:8px">Save</button></form></div>`;
  return shell("Worker", content);
}

async function saveWorker(env: Env, id: number, form: FormData): Promise<Response> {
  const f = (k: string) => String(form.get(k) ?? "").trim().replace(/\s+/g, " ");
  const mobile = normaliseMobile(f("mobile"));
  if (!f("first_name") || !f("surname") || !f("company")) return workerPage(env, id, "Name and company are required.");
  if (!mobile) return workerPage(env, id, "Please enter a valid Australian mobile.");
  const clash = await env.DB.prepare("SELECT id FROM workers WHERE mobile = ? AND id != ?").bind(mobile, id).first();
  if (clash) return workerPage(env, id, "Another worker already has that mobile number.");
  await env.DB.prepare("UPDATE workers SET first_name = ?, surname = ?, mobile = ?, company = ?, active = ? WHERE id = ?")
    .bind(f("first_name").slice(0, 40), f("surname").slice(0, 40), mobile, f("company").slice(0, 80), form.get("active") === "1" ? 1 : 0, id).run();
  return redirect(`/admin/workers?msg=${encodeURIComponent("Saved.")}`);
}
