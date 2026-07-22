import { redirect, type LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { getSettings, setSettings } from "~/lib/settings.server";
import { buildAuthorizeUrl } from "~/lib/shopify.server";

/** Starts the Shopify OAuth flow: /admin/shopify/connect → Shopify approval screen. */
export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request, { role: "admin" });
  const settings = await getSettings(context, [
    "shopify_domain",
    "shopify_client_id",
    "shopify_client_secret",
  ]);
  if (!settings.shopify_domain || !settings.shopify_client_id || !settings.shopify_client_secret) {
    throw redirect(
      "/admin/settings?shopify_error=" +
        encodeURIComponent("Enter the shop domain, client ID and client secret first."),
    );
  }

  // One-time state nonce, checked (and cleared) by the callback.
  const state = crypto.randomUUID();
  await setSettings(context, { shopify_oauth_state: `${state}:${Date.now()}` });

  const redirectUri = `${new URL(request.url).origin}/admin/shopify/callback`;
  throw redirect(
    buildAuthorizeUrl({
      domain: settings.shopify_domain,
      clientId: settings.shopify_client_id,
      redirectUri,
      state,
    }),
  );
}
