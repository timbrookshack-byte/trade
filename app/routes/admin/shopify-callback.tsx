import { redirect, type LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { getSettings, setSettings } from "~/lib/settings.server";
import { exchangeCodeForToken, verifyCallbackHmac } from "~/lib/shopify.server";

function fail(message: string): never {
  throw redirect("/admin/settings?shopify_error=" + encodeURIComponent(message));
}

/** Shopify redirects here after approval; verifies and stores the access token. */
export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request, { role: "admin" });
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) fail("Shopify didn't return an authorisation code.");

  const settings = await getSettings(context, [
    "shopify_domain",
    "shopify_client_id",
    "shopify_client_secret",
    "shopify_oauth_state",
  ]);
  if (!settings.shopify_client_secret || !settings.shopify_client_id || !settings.shopify_domain) {
    fail("Shopify client settings are missing.");
  }

  const [expectedState, startedAt] = (settings.shopify_oauth_state ?? "").split(":");
  if (!expectedState || expectedState !== state) {
    fail("Connection attempt didn't match — start again from Settings.");
  }
  if (Date.now() - Number(startedAt) > 10 * 60_000) {
    fail("Connection attempt expired — start again from Settings.");
  }
  if (!(await verifyCallbackHmac(url.searchParams, settings.shopify_client_secret))) {
    fail("Shopify signature check failed.");
  }

  try {
    const token = await exchangeCodeForToken({
      domain: settings.shopify_domain,
      clientId: settings.shopify_client_id,
      clientSecret: settings.shopify_client_secret,
      code,
    });
    await setSettings(context, { shopify_admin_token: token, shopify_oauth_state: "" });
  } catch (err) {
    fail(err instanceof Error ? err.message : "Token exchange failed.");
  }
  throw redirect("/admin/settings?shopify=connected");
}
