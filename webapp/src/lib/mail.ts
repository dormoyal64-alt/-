import nodemailer from "nodemailer";

/**
 * The business's own mailbox, used by every route that has to post something.
 *
 * It signs in to the Gmail account the business already owns rather than a
 * sending service, for two reasons: the accountant receives it from the address
 * they already know, and there is no new account, no new domain to verify and
 * no second bill. The app password lives in an environment variable the browser
 * never sees.
 *
 * Two routes now send mail — the monthly accountant report and the advertising
 * report — and both have to fail the same way and name the same fixes, so the
 * setup lives here once rather than drifting apart in two copies.
 */

export const MAIL_FROM = process.env.GMAIL_USER;
const MAIL_PASSWORD = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");

/** Whether the screens may offer a real send at all. */
export function mailConfigured(): boolean {
  return !!MAIL_FROM && !!MAIL_PASSWORD;
}

/**
 * Gmail, unless a loopback address was named.
 *
 * The override exists so a send can be exercised against a local stand-in
 * server; it refuses to drop TLS for anything that is not on this machine, so
 * there is no configuration that quietly posts the business's mail in the
 * clear.
 */
export function smtpConfig() {
  const auth = { user: MAIL_FROM!, pass: MAIL_PASSWORD! };
  const host = process.env.SMTP_HOST;
  if (!host) return { service: "gmail", auth };
  const local = host === "127.0.0.1" || host === "localhost" || host === "::1";
  return {
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    ignoreTLS: local,
    requireTLS: !local,
    auth,
  };
}

export interface Attachment {
  filename: string;
  content: string | Buffer;
  contentType: string;
}

/** Post one message as the business, and give back nothing worth logging. */
export async function sendMail(options: {
  to: string;
  cc?: string | null;
  replyTo?: string | null;
  fromName?: string | null;
  subject: string;
  text: string;
  attachments?: Attachment[];
}) {
  const transport = nodemailer.createTransport(smtpConfig());
  await transport.sendMail({
    from: options.fromName?.trim() ? `"${options.fromName.trim()}" <${MAIL_FROM}>` : MAIL_FROM,
    to: options.to,
    cc: options.cc?.trim() || undefined,
    replyTo: options.replyTo?.trim() || undefined,
    subject: options.subject,
    text: options.text,
    attachments: options.attachments,
  });
}

/**
 * Google's own words, when they help.
 *
 * A rejected password and a blocked sign-in are different problems with
 * different fixes, and "sending failed" sends the business looking in the
 * wrong place for both.
 */
export function mailError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e ?? "");
  if (/invalid login|username and password not accepted|535/i.test(message)) {
    return "Gmail דחה את פרטי ההתחברות. צריך סיסמת אפליקציה (App Password), לא סיסמת החשבון הרגילה.";
  }
  if (/timed out|ETIMEDOUT|ECONNREFUSED/i.test(message)) {
    return "לא הצלחנו להתחבר לשרת של Gmail. נסו שוב בעוד רגע.";
  }
  return message ? `השליחה נכשלה: ${message}` : "השליחה נכשלה.";
}
