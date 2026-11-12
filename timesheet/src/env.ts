export interface Env {
  DB: D1Database;
  /** Alex's manager code — overrides at the kiosk, kiosk device setup, manager area. Secret. */
  MANAGER_CODE: string;
  /** Signs the kiosk-device and manager cookies. Secret. */
  SESSION_SECRET: string;
  /** Resend API key for the weekly summary email. Secret; email is skipped without it. */
  RESEND_API_KEY?: string;
  EMAIL_FROM: string;
  /** Comma-separated recipients of the Monday 5am summary. */
  SUMMARY_TO: string;
  MANAGER_NAME: string;
}
