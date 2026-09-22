import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { JOB_SELECT } from "@/lib/api/jobs";
import { toWhatsappNumber, buildOrderConfirmationMessage, visitFeeForJob } from "@/lib/whatsapp";
import { formatAgorotPlain } from "@/lib/money";
import { BUSINESS_TIME_ZONE, formatAppointmentWindowHe } from "@/lib/dates";
import type { AppSettings, JobWithRelations } from "@/lib/types";

/**
 * Sending the order to the customer without anyone opening WhatsApp.
 *
 * This runs on the server for one reason: the access token. It is a permanent
 * key to the business's WhatsApp account, so it lives in an environment
 * variable that the browser never sees, and every send goes through here.
 *
 * The caller must be a signed-in user of this system, and the job is read
 * back through their own session — so row level security decides what they
 * may send, exactly as it decides what they may see.
 */

export const dynamic = "force-dynamic";

const API_BASE = process.env.WHATSAPP_API_BASE || "https://graph.facebook.com/v21.0";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME || "order_confirmation";
const TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || "he";

function configured(): boolean {
  return !!PHONE_NUMBER_ID && !!ACCESS_TOKEN;
}

/** Whether automatic sending is switched on, for the screens that offer it. */
export async function GET() {
  return NextResponse.json({ configured: configured(), template: TEMPLATE_NAME });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "לא מחוברים למערכת" }, { status: 401 });
  }

  if (!configured()) {
    return NextResponse.json(
      { ok: false, configured: false, error: "שליחה אוטומטית לא מוגדרת" },
      { status: 503 }
    );
  }

  let jobId: string | undefined;
  try {
    jobId = (await request.json())?.jobId;
  } catch {
    jobId = undefined;
  }
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "חסר מזהה עבודה" }, { status: 400 });
  }

  const { data: job } = await supabase.from("jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  if (!job) {
    return NextResponse.json({ ok: false, error: "העבודה לא נמצאה" }, { status: 404 });
  }
  const { data: settings } = await supabase.from("app_settings").select("*").eq("id", true).maybeSingle();

  const to = toWhatsappNumber((job as JobWithRelations).customer_phone);
  if (!to) {
    return NextResponse.json({ ok: false, error: "ללקוח אין מספר טלפון תקין" }, { status: 400 });
  }

  const payload = buildPayload(to, job as JobWithRelations, settings as AppSettings | null);

  let meta: { ok: boolean; status: number; body: unknown };
  try {
    const response = await fetch(`${API_BASE}/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    meta = { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return NextResponse.json(
      { ok: false, error: "לא הצלחנו להגיע לשרת של WhatsApp. נסו לשלוח ידנית." },
      { status: 502 }
    );
  }

  if (!meta.ok) {
    return NextResponse.json({ ok: false, error: metaError(meta.body) }, { status: 502 });
  }

  // only a message that actually left is recorded as sent
  await supabase
    .from("jobs")
    .update({ confirmation_sent_at: new Date().toISOString() })
    .eq("id", jobId);

  return NextResponse.json({ ok: true });
}

/**
 * A template when one is configured, plain text otherwise.
 *
 * WhatsApp only lets a business open a conversation with an approved
 * template; free text reaches a customer who has written to us in the last
 * day and is refused for everyone else. The template's button carries the
 * confirmation token as its URL suffix, so the customer gets a real button
 * rather than a link to pick out of a paragraph.
 */
function buildPayload(to: string, job: JobWithRelations, settings: AppSettings | null) {
  if (!TEMPLATE_NAME) {
    return {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: true, body: buildOrderConfirmationMessage(job, settings, siteUrl()) },
    };
  }

  const window = settings?.eta_window_minutes ?? 60;
  const eta = job.scheduled_at
    ? formatAppointmentWindowHe(job.scheduled_at, window, BUSINESS_TIME_ZONE)
    : "בהקדם — ניצור קשר לתיאום מדויק";
  const issue = [job.job_type?.name, job.notes?.trim()].filter(Boolean).join(" — ") || "לפי השיחה בטלפון";

  const components: unknown[] = [
    {
      type: "body",
      parameters: [
        { type: "text", text: job.customer_name },
        { type: "text", text: job.address_full ?? job.city?.name ?? "" },
        { type: "text", text: issue },
        { type: "text", text: eta },
        { type: "text", text: formatAgorotPlain(visitFeeForJob(job, settings)) },
      ],
    },
  ];
  if (job.confirm_token) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: job.confirm_token }],
    });
  }

  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: { name: TEMPLATE_NAME, language: { code: TEMPLATE_LANG }, components },
  };
}

function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : "";
}

/**
 * Meta's own words, when they help, and never the token.
 *
 * Its errors name the real problem — a template not approved yet, a number
 * outside the allowed list, an expired key — and hiding them behind "send
 * failed" would leave the business guessing at a setup they can fix.
 */
function metaError(body: unknown): string {
  const error = (body as { error?: { message?: string; error_user_msg?: string } } | null)?.error;
  const detail = error?.error_user_msg || error?.message;
  return detail ? `WhatsApp דחה את השליחה: ${detail}` : "WhatsApp דחה את השליחה. נסו לשלוח ידנית.";
}
