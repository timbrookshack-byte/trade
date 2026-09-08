import {
  createCookieSessionStorage,
  redirect,
  type AppLoadContext,
} from "react-router";
import { hashPassword, verifyPassword } from "./auth.server";
import type { BusinessType } from "./customers";

export interface Customer {
  id: number;
  business_name: string;
  abn: string;
  business_type: BusinessType;
  contact_name: string;
  email: string;
  phone: string;
  address: string;
  price_tier: string;
  credit_terms: string;
  approved: boolean;
  approved_at: string | null;
  active: boolean;
  created_at: string;
  how_heard?: string;
  website?: string;
  social_media?: string;
  current_projects?: string;
  additional_info?: string;
}

const CUSTOMER_COLS = `id, business_name, abn, business_type, contact_name, email, phone,
  address, price_tier, credit_terms, approved, approved_at, active, created_at`;

// Separate cookie from the admin session so a trade-team member can be logged
// into both sides at once.
function getSessionStorage(env: Env) {
  return createCookieSessionStorage({
    cookie: {
      name: "__tp_trade",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: import.meta.env.PROD,
      secrets: [env.SESSION_SECRET],
      maxAge: 60 * 60 * 24 * 30, // 30 days
    },
  });
}

export async function createCustomerSession(
  context: AppLoadContext,
  customerId: number,
  redirectTo: string,
) {
  const storage = getSessionStorage(context.cloudflare.env);
  const session = await storage.getSession();
  session.set("customerId", customerId);
  return redirect(redirectTo, {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

export async function logoutCustomer(context: AppLoadContext, request: Request) {
  const storage = getSessionStorage(context.cloudflare.env);
  const session = await storage.getSession(request.headers.get("Cookie"));
  return redirect("/", {
    headers: { "Set-Cookie": await storage.destroySession(session) },
  });
}

/** The logged-in trade customer, or null. Prices show only when `approved`. */
export async function getCustomer(
  context: AppLoadContext,
  request: Request,
): Promise<Customer | null> {
  const storage = getSessionStorage(context.cloudflare.env);
  const session = await storage.getSession(request.headers.get("Cookie"));
  const customerId = Number(session.get("customerId"));
  if (!Number.isInteger(customerId) || customerId < 1) return null;
  const rows = await context.db<Customer[]>`
    SELECT ${context.db.unsafe(CUSTOMER_COLS)} FROM customers
    WHERE id = ${customerId} AND active = TRUE
  `;
  return rows[0] ?? null;
}

export async function verifyCustomerLogin(
  context: AppLoadContext,
  email: string,
  password: string,
) {
  const rows = await context.db<(Customer & { password_hash: string })[]>`
    SELECT ${context.db.unsafe(CUSTOMER_COLS)}, password_hash FROM customers
    WHERE lower(email) = lower(${email}) AND active = TRUE
  `;
  const customer = rows[0];
  if (!customer) return null;
  if (!(await verifyPassword(password, customer.password_hash))) return null;
  await context.db`UPDATE customers SET last_login_at = now() WHERE id = ${customer.id}`;
  const { password_hash: _discard, ...safe } = customer;
  return safe as Customer;
}

/**
 * Create (or refresh) an invite/set-password token. Returns the URL path.
 * Admin invites default to 14 days; self-serve forgot-password links pass 1.
 */
export async function createInviteToken(
  context: AppLoadContext,
  customerId: number,
  days = 14,
) {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await context.db`
    INSERT INTO password_resets (customer_id, token, expires_at)
    VALUES (${customerId}, ${token}, now() + (${days} * interval '1 day'))
  `;
  return `/trade/set-password?token=${token}`;
}

export async function consumeInviteToken(context: AppLoadContext, token: string) {
  const rows = await context.db<{ id: number; customer_id: number }[]>`
    SELECT id, customer_id FROM password_resets
    WHERE token = ${token} AND used_at IS NULL AND expires_at > now()
  `;
  return rows[0] ?? null;
}

export async function registerCustomer(
  context: AppLoadContext,
  input: {
    business_name: string;
    abn: string;
    business_type: BusinessType;
    contact_name: string;
    email: string;
    phone: string;
    address: string;
    password: string;
    how_heard: string;
    website: string;
    social_media: string;
    current_projects: string;
    additional_info: string;
  },
) {
  const db = context.db;
  const existing = await db`
    SELECT 1 FROM customers WHERE lower(email) = lower(${input.email})
  `;
  if (existing.length > 0) return null;
  const password_hash = await hashPassword(input.password);
  const rows = await db<{ id: number }[]>`
    INSERT INTO customers (business_name, abn, business_type, contact_name, email, phone,
                           address, password_hash, how_heard, website, social_media,
                           current_projects, additional_info)
    VALUES (${input.business_name}, ${input.abn}, ${input.business_type}, ${input.contact_name},
            lower(${input.email}), ${input.phone}, ${input.address}, ${password_hash},
            ${input.how_heard}, ${input.website}, ${input.social_media},
            ${input.current_projects}, ${input.additional_info})
    RETURNING id
  `;
  return rows[0];
}
