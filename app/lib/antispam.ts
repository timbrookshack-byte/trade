// Client-safe: route COMPONENTS render the Turnstile widget, so this
// constant must not live in antispam.server.ts (server-only exports can't
// be referenced by component code — the build refuses).
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js";
