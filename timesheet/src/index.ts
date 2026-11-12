import type { Env } from "./env";
import { handleAdmin } from "./admin";
import { checkManagerCode, hasCookie, KIOSK_MAX_AGE, makeCookie } from "./auth";
import { arrive, finish, json, listWorkers, registerWorker } from "./kiosk";
import { devicePage, kioskPage } from "./pages";
import { previousWeekStart, sendSummary } from "./summary";

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;

  if (p === "/device") {
    if (req.method !== "POST") return devicePage();
    const res = await checkManagerCode(env, (await req.formData()).get("code"));
    if (!res.ok) return devicePage(res.error);
    return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": await makeCookie(env, "kiosk", KIOSK_MAX_AGE) } });
  }

  if (p === "/admin" || p.startsWith("/admin/")) return handleAdmin(req, env, url);

  // Everything below is the kiosk — only from the set-up laptop.
  if (!(await hasCookie(req, env, "kiosk"))) {
    if (p.startsWith("/api/")) return json({ error: "This device isn't set up as the sign-in kiosk." }, 401);
    return Response.redirect(new URL("/device", url).toString(), 303);
  }

  if (p === "/" && req.method === "GET") {
    const res = kioskPage(env.MANAGER_NAME);
    res.headers.append("Set-Cookie", await makeCookie(env, "kiosk", KIOSK_MAX_AGE)); // keep the 400-day cookie fresh
    return res;
  }
  if (p === "/api/workers" && req.method === "GET") return listWorkers(env);

  if (req.method === "POST" && p.startsWith("/api/")) {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return json({ error: "Bad request" }, 400);
    if (p === "/api/workers") return registerWorker(env, body);
    if (p === "/api/arrive") return arrive(env, body);
    if (p === "/api/finish") return finish(env, body);
  }
  return new Response("Not found", { status: 404 });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (!env.MANAGER_CODE || !env.SESSION_SECRET) return new Response("MANAGER_CODE and SESSION_SECRET secrets must be set.", { status: 500 });
    try {
      return await route(req, env);
    } catch (e) {
      console.error(e);
      return new Response("Something went wrong — please try again.", { status: 500 });
    }
  },

  // Monday 5:00am Brisbane: email last week's (Mon–Sun) hours.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(sendSummary(env, previousWeekStart(), "cron").then((r) => console.log("weekly summary:", r.detail)));
  },
} satisfies ExportedHandler<Env>;
