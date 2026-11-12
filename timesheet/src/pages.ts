import { esc } from "./summary";

export const BASE_CSS = `
:root{--ink:#111;--muted:#666;--line:#e5e5e5;--bg:#f6f6f4;--card:#fff;--brand:#c026d3;--brand-dark:#a21caf;--ok:#15803d;--okbg:#dcfce7;--warn:#b91c1c}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
button,input,select{font:inherit}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:12px;padding:14px 22px;font-weight:600;cursor:pointer;background:var(--ink);color:#fff;text-decoration:none;font-size:16px}
.btn:hover{opacity:.9}.btn:disabled{opacity:.5;cursor:default}
.btn.brand{background:var(--brand)}.btn.ghost{background:transparent;color:var(--ink);border:2px solid var(--line)}
.btn.big{font-size:22px;padding:20px 30px;border-radius:16px}
.btn.sm{font-size:14px;padding:8px 14px;border-radius:10px}
.link{background:none;border:0;color:var(--muted);text-decoration:underline;cursor:pointer;font-size:15px;padding:6px}
input[type=text],input[type=tel],input[type=password],input[type=time],input[type=date],input[type=number],input[type=search],select{width:100%;padding:12px 14px;border:2px solid var(--line);border-radius:10px;background:#fff;font-size:17px}
input:focus,select:focus{outline:none;border-color:var(--ink)}
label{display:block;font-weight:600;margin:14px 0 6px}
.err{color:var(--warn);font-weight:600;margin-top:12px;min-height:1.2em}
`;

export function page(title: string, body: string, extraHead = ""): Response {
  const html = `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>${BASE_CSS}</style>${extraHead}</head><body>${body}</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export function devicePage(error = ""): Response {
  return page("Set up sign-in kiosk", `
<div style="max-width:440px;margin:10vh auto;padding:0 16px">
  <div style="background:#fff;border-radius:18px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,.06)">
    <h1 style="margin:0 0 8px;font-size:24px">Set up this laptop as the sign-in kiosk</h1>
    <p style="color:#666;margin:0 0 8px">Only the manager can do this. Once set up, this Chrome browser stays signed in as the kiosk — workers can't sign in from their phones or anywhere else.</p>
    <form method="post" action="/device">
      <label for="code">Manager code</label>
      <input id="code" name="code" type="password" inputmode="numeric" autocomplete="off" required autofocus>
      <div class="err">${esc(error)}</div>
      <button class="btn" style="width:100%;margin-top:8px">Set up kiosk</button>
    </form>
    <p style="margin:18px 0 0;font-size:14px"><a href="/admin" style="color:#666">Manager area →</a></p>
  </div>
</div>`);
}

export function kioskPage(managerName: string): Response {
  const head = `<style>
header{background:#111;color:#fff;padding:16px 28px;display:flex;align-items:center;justify-content:space-between}
header .brand{font-weight:800;font-size:20px;letter-spacing:.2px}header .brand span{color:#e879f9}
header .clock{text-align:right}header .clock b{font-size:28px;display:block;font-variant-numeric:tabular-nums}
main{max-width:1200px;margin:0 auto;padding:24px 28px 60px}
.top{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:20px}
.top h1{margin:0;font-size:30px;flex:1 1 360px}
.search{flex:0 1 340px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
.card{background:#fff;border:2px solid transparent;border-radius:16px;padding:18px;text-align:left;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.06);transition:transform .08s}
.card:hover{border-color:#111}.card:active{transform:scale(.98)}
.card .nm{font-size:20px;font-weight:700}.card .co{color:#666;font-size:14px;margin-top:2px}
.pill{display:inline-block;margin-top:10px;font-size:13px;font-weight:600;padding:4px 10px;border-radius:99px;background:#f1f1f1;color:#555}
.pill.on{background:var(--okbg);color:var(--ok)}.pill.done{background:#ececec;color:#777}
.empty{color:#666;padding:40px 0;text-align:center;font-size:18px}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;padding:16px;z-index:10}
.overlay.open{display:flex}
.panel{background:#fff;border-radius:22px;padding:34px;width:min(560px,100%);max-height:94vh;overflow:auto;text-align:center}
.panel h2{font-size:30px;margin:0 0 8px}.panel p{font-size:18px;color:#444;margin:8px 0}
.panel .row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:20px}
.panel form{text-align:left}
.choice{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:12px}
.choice .btn{min-width:90px}.choice .btn.sel{background:var(--brand)}
.tick{width:84px;height:84px;border-radius:50%;background:var(--okbg);color:var(--ok);display:flex;align-items:center;justify-content:center;font-size:48px;margin:0 auto 14px}
.note{background:#fff7ed;color:#9a3412;border-radius:12px;padding:12px;font-size:15px!important;margin-top:16px!important}
.summary{background:#f6f6f4;border-radius:12px;padding:12px;font-size:16px!important}
.check{display:flex;gap:12px;align-items:flex-start;font-weight:500;margin-top:18px;background:#f6f6f4;border-radius:12px;padding:14px;cursor:pointer}
.check input{width:24px;height:24px;flex:none;margin:0}
.big-time{font-size:44px;font-weight:800;font-variant-numeric:tabular-nums;margin:6px 0}
</style>`;

  const body = `
<header><div class="brand">The Furniture Shack <span>· Site sign-in</span></div><div class="clock"><b id="clock">--:--</b><span id="date"></span></div></header>
<main>
  <div class="top">
    <h1 id="hello">Tap your name to sign in or out</h1>
    <input class="search" id="q" type="search" placeholder="Search your name…" autocomplete="off">
    <button class="btn brand" id="newBtn">+ I'm new here</button>
  </div>
  <div class="grid" id="grid"></div>
  <div class="empty" id="empty" hidden></div>
</main>
<div class="overlay" id="ov"><div class="panel" id="panel"></div></div>
<script>
var MANAGER = ${JSON.stringify(managerName)};
var workers = [];
var state = {};
var closeTimer = null;

function $(id){ return document.getElementById(id); }
function h(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function nowParts(){
  var d = new Date(Date.now() + 10*3600*1000);
  var hh = d.getUTCHours(), mm = d.getUTCMinutes();
  return { hh: hh, mm: mm, hhmm: (hh<10?"0":"")+hh+":"+(mm<10?"0":"")+mm, nice: ((hh%12)||12)+":"+(mm<10?"0":"")+mm+(hh>=12?"pm":"am") };
}
function tickClock(){
  var p = nowParts();
  $("clock").textContent = p.nice;
  $("date").textContent = new Date().toLocaleDateString("en-AU", { timeZone: "Australia/Brisbane", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  var g = p.hh < 12 ? "Good morning" : p.hh < 17 ? "Good afternoon" : "Good evening";
  $("hello").textContent = g + "! Tap your name to sign in or out";
}

function api(path, body){
  return fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
    .then(function(r){ return r.json().catch(function(){ return { error: "Something went wrong — please try again." }; }).then(function(j){ if (r.status === 401 && !j.error) j.error = "Not authorised"; return j; }); })
    .catch(function(){ return { error: "Can't reach the server — check the internet connection and try again." }; });
}

function load(){
  return api("/api/workers").then(function(j){
    if (j.error) { $("empty").hidden = false; $("empty").textContent = j.error; return; }
    workers = j.workers; render();
  });
}

function render(){
  var q = $("q").value.trim().toLowerCase();
  var list = workers.filter(function(w){ return !q || (w.first_name + " " + w.surname + " " + w.company).toLowerCase().indexOf(q) >= 0; });
  $("grid").innerHTML = list.map(function(w){
    var pill = w.status === "on_site" ? '<span class="pill on">On site since ' + h(w.arrived) + '</span>'
      : w.status === "finished" ? '<span class="pill done">Finished ' + h(w.finished) + '</span>'
      : '<span class="pill">Not signed in</span>';
    return '<button class="card" data-id="' + w.id + '"><div class="nm">' + h(w.first_name) + ' ' + h(w.surname) + '</div><div class="co">' + h(w.company) + '</div>' + pill + '</button>';
  }).join("");
  var empty = $("empty");
  empty.hidden = list.length > 0;
  empty.innerHTML = workers.length === 0 ? "No one is registered yet. Tap <b>I'm new here</b> to get started." : "No match for that name. New here? Tap <b>I'm new here</b>.";
}

function open(html){ clearTimeout(closeTimer); $("panel").innerHTML = html; $("ov").classList.add("open"); var f = $("panel").querySelector("[autofocus]"); if (f) f.focus(); }
function close(){ clearTimeout(closeTimer); $("ov").classList.remove("open"); state = {}; $("q").value = ""; load(); }
function err(msg){ var e = $("panel").querySelector(".err"); if (e) e.textContent = msg || ""; }
function busy(on){ $("panel").querySelectorAll("button").forEach(function(b){ b.disabled = on; }); }

function openWorker(w){
  state = { w: w };
  if (w.status === "not_arrived") return showArrive();
  if (w.status === "on_site") return showBreak();
  open('<h2>Hi ' + h(w.first_name) + '!</h2><p>You signed out today at <b>' + h(w.finished) + '</b>.</p><p>See you next time! If something isn\\'t right, please let ' + h(MANAGER) + ' know.</p><div class="row"><button class="btn" data-act="close">OK</button></div>');
}

function showArrive(){
  var w = state.w;
  open('<h2>Hi ' + h(w.first_name) + '!</h2><p>Signing you in at</p><div class="big-time" id="arrTime">' + nowParts().nice + '</div>'
    + '<div class="row"><button class="btn brand big" data-act="arrive" autofocus>I\\'ve arrived</button></div>'
    + '<div class="err"></div>'
    + '<div class="row"><button class="link" data-act="close">Not you? Go back</button><button class="link" data-act="ovArrive">Override with manager</button></div>');
}

function showBreak(){
  var w = state.w;
  open('<h2>Finishing up, ' + h(w.first_name) + '?</h2><p>You arrived at <b>' + h(w.arrived) + '</b>.</p>'
    + '<p style="margin-top:22px;font-weight:700;color:#111">Did you have a break today?</p>'
    + '<div class="choice"><button class="btn big ' + (state.breakTaken === true ? "sel" : "ghost") + '" data-act="breakYes">Yes</button><button class="btn big ' + (state.breakTaken === false ? "sel" : "ghost") + '" data-act="breakNo">No</button></div>'
    + (state.breakTaken === true ? '<p style="margin-top:18px">How long was your break?</p><div class="choice">' + [15,30,45,60,90].map(function(m){ return '<button class="btn ' + (state.breakMins === m ? "sel" : "ghost") + '" data-act="mins" data-m="' + m + '">' + m + ' min</button>'; }).join("") + '</div>' : '')
    + '<div class="err"></div>'
    + '<div class="row"><button class="btn big" data-act="finish"' + (ready() ? "" : " disabled") + '>Finish for the day</button></div>'
    + '<div class="row"><button class="link" data-act="close">Not you? Go back</button><button class="link" data-act="ovFinish"' + (ready() ? "" : " disabled") + '>Override with manager</button></div>');
}
function ready(){ return state.breakTaken === false || (state.breakTaken === true && !!state.breakMins); }

function showOverride(kind){
  state.ov = kind;
  var w = state.w;
  open('<h2>Manager override</h2><p>' + h(w.first_name) + ' ' + h(w.surname) + ' — ' + (kind === "arrive" ? "arrival" : "finish") + ' time today.</p>'
    + '<form id="ovForm"><label for="ovTime">' + (kind === "arrive" ? "Arrival" : "Finish") + ' time</label><input id="ovTime" type="time" required value="' + nowParts().hhmm + '">'
    + '<label for="ovReason">Reason</label><input id="ovReason" type="text" required maxlength="200" placeholder="e.g. Arrived 6:45, forgot to sign in">'
    + '<label for="ovCode">Manager code (' + h(MANAGER) + ')</label><input id="ovCode" type="password" inputmode="numeric" autocomplete="off" required>'
    + '<div class="err"></div><div class="row"><button type="button" class="btn ghost" data-act="back">Cancel</button><button class="btn brand">Save time</button></div></form>');
  $("ovTime").focus();
  $("ovForm").addEventListener("submit", function(e){
    e.preventDefault();
    submit(kind, { time: $("ovTime").value, reason: $("ovReason").value, code: $("ovCode").value });
  });
}

function submit(kind, override){
  busy(true); err("");
  var body = { worker_id: state.w.id };
  if (kind === "finish") { body.break_taken = state.breakTaken; body.break_minutes = state.breakMins || 0; }
  if (override) body.override = override;
  api("/api/" + kind, body).then(function(j){
    busy(false);
    if (j.error) return err(j.error);
    success(j);
  });
}

function success(j){
  open('<div class="tick">✓</div><h2>' + h(j.title) + '</h2><p style="font-size:21px;color:#111">' + h(j.message) + '</p>'
    + (j.summary ? '<p class="summary">' + h(j.summary) + '</p>' : '')
    + (j.note ? '<p class="note">' + h(j.note) + '</p>' : '')
    + '<div class="row"><button class="btn" data-act="close" autofocus>Done</button></div>');
  closeTimer = setTimeout(close, j.note ? 15000 : 8000);
}

function showRegister(){
  state = {};
  open('<h2>Welcome! Let\\'s get you set up</h2><p>This only takes a moment, and you\\'ll only need to do it once.</p>'
    + '<form id="regForm" autocomplete="off">'
    + '<div style="display:flex;gap:12px"><div style="flex:1"><label for="fn">First name</label><input id="fn" type="text" required maxlength="40" autocapitalize="words"></div>'
    + '<div style="flex:1"><label for="sn">Surname</label><input id="sn" type="text" required maxlength="40" autocapitalize="words"></div></div>'
    + '<label for="mob">Mobile number</label><input id="mob" type="tel" required placeholder="0412 345 678" maxlength="20">'
    + '<label for="co">Contract company</label><input id="co" type="text" required maxlength="80" list="companies" placeholder="Who do you work for?">'
    + '<datalist id="companies">' + companies().map(function(c){ return '<option value="' + h(c) + '">'; }).join("") + '</datalist>'
    + '<label class="check"><input id="ind" type="checkbox" required><span>I have been inducted and I am aware of the workplace rules and regulations.</span></label>'
    + '<div class="err"></div><div class="row"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn brand">Register &amp; sign in</button></div></form>');
  $("fn").focus();
  $("regForm").addEventListener("submit", function(e){
    e.preventDefault();
    if (!$("ind").checked) return err("Please tick to confirm you've been inducted.");
    busy(true); err("");
    api("/api/workers", { first_name: $("fn").value, surname: $("sn").value, mobile: $("mob").value, company: $("co").value, inducted: $("ind").checked }).then(function(j){
      busy(false);
      if (j.error) return err(j.error);
      workers.push(j.worker);
      state = { w: j.worker };
      showArrive();
    });
  });
}
function companies(){ var seen = {}; return workers.map(function(w){ return w.company; }).filter(function(c){ var k = c.toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; }).sort(); }

document.addEventListener("click", function(e){
  var card = e.target.closest(".card");
  if (card) { var w = workers.filter(function(x){ return x.id === Number(card.dataset.id); })[0]; if (w) openWorker(w); return; }
  var b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
  var act = b.dataset.act;
  if (act === "close") close();
  else if (act === "arrive") submit("arrive");
  else if (act === "ovArrive") showOverride("arrive");
  else if (act === "breakYes") { state.breakTaken = true; showBreak(); }
  else if (act === "breakNo") { state.breakTaken = false; state.breakMins = 0; showBreak(); }
  else if (act === "mins") { state.breakMins = Number(b.dataset.m); showBreak(); }
  else if (act === "finish") submit("finish");
  else if (act === "ovFinish") showOverride("finish");
  else if (act === "back") { if (state.ov === "arrive") showArrive(); else showBreak(); }
});
$("ov").addEventListener("click", function(e){ if (e.target === $("ov")) close(); });
$("q").addEventListener("input", render);
$("newBtn").addEventListener("click", showRegister);

tickClock(); setInterval(function(){ tickClock(); var t = $("arrTime"); if (t) t.textContent = nowParts().nice; }, 1000);
load(); setInterval(function(){ if (!$("ov").classList.contains("open")) load(); }, 60000);
</script>`;
  return page("Site sign-in — The Furniture Shack", body, head);
}
