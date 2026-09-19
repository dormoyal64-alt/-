import type { AppSettings, JobWithRelations } from "@/lib/types";
import { formatAgorotPlain } from "@/lib/money";
import { formatAppointmentHe, formatAppointmentWindowHe } from "@/lib/dates";

// Normalizes an Israeli phone/WhatsApp number to international format without "+" (required by wa.me)
export function toWhatsappNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.startsWith("972")) return digits;
  if (digits.startsWith("0")) return "972" + digits.slice(1);
  return digits;
}

export function buildWhatsappLink(numberRaw: string | null | undefined, message = ""): string | null {
  const number = toWhatsappNumber(numberRaw);
  if (!number) return null;
  const params = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${number}${params}`;
}

/**
 * Whether this job's contractor message carries the customer's phone number.
 * The job's own choice wins; null falls back to the standing setting, so
 * changing the policy moves every job that never decided for itself.
 */
export function sendsCustomerPhone(
  job: Pick<JobWithRelations, "send_customer_phone">,
  settingDefault: boolean | null | undefined
): boolean {
  if (job.send_customer_phone != null) return job.send_customer_phone;
  return settingDefault ?? true;
}

export function buildNewJobWhatsappMessage(
  job: JobWithRelations,
  options?: { includeCustomerPhone?: boolean }
): string {
  // Default true keeps every existing caller behaving as it did.
  const withPhone = options?.includeCustomerPhone ?? true;
  const lines = [
    "🛠️ *עבודה חדשה*",
    "",
    `מס' עבודה: ${job.job_number}`,
    job.profession?.name ? `תחום: ${job.profession.name}` : null,
    job.job_type?.name ? `סוג עבודה: ${job.job_type.name}` : null,
    // the hour the customer asked for is the first thing a contractor needs
    // to know, so it sits above the details of the job itself
    job.scheduled_at ? `⏰ מועד מבוקש: ${formatAppointmentHe(job.scheduled_at)}` : null,
    `שם לקוח: ${job.customer_name}`,
    // Withholding the number without saying so just leaves the contractor
    // hunting for it, so the message says where to get the customer instead.
    withPhone ? `טלפון לקוח: ${job.customer_phone}` : "טלפון לקוח: לתיאום מול הלקוח — דברו איתי",
    job.city?.name ? `עיר: ${job.city.name}` : null,
    job.address_full ? `כתובת: ${job.address_full}` : null,
    job.quoted_price_agorot ? `מחיר שנאמר בטלפון: ${formatAgorotPlain(job.quoted_price_agorot)}` : null,
    job.payment_method?.name ? `אמצעי תשלום: ${job.payment_method.name}` : null,
    job.notes ? `הערות: ${job.notes}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

const DEFAULT_ON_THE_WAY =
  "שלום {customer}, {technician} כבר בדרך אליך 🚚\nנא להיות זמין/ה לקבלת השירות.\nתודה!";

const DEFAULT_CANCELLATION_NOTICE =
  "⚠️ שימו לב: ביטול הקריאה לאחר ההזמנה, מסיבה שאינה תלויה בנו — למשל אם הוזמן בינתיים טכנאי אחר — " +
  "כרוך בתשלום של {fee} עבור ההגעה.";

// Tells the customer the tradesperson is on the way, in the wording that fits
// this profession ("טכנאי האינסטלציה" / "החשמלאי" / "המנעולן"...).
export function buildOnTheWayMessage(
  job: JobWithRelations,
  template?: string | null,
  cancellationNotice?: string | null
): string {
  const technician = job.profession?.technician_label?.trim() || "הטכנאי";
  const body = (template && template.trim()) || DEFAULT_ON_THE_WAY;
  const filled = body
    .replace(/\{technician\}/g, technician)
    .replace(/\{customer\}/g, job.customer_name)
    .replace(/\{address\}/g, job.address_full ?? job.city?.name ?? "");
  // only append the address when the template did not already place it
  const withAddress =
    !/\{address\}/.test(body) && job.address_full ? filled + "\nכתובת: " + job.address_full : filled;
  // the notice goes last, set off from the message, so it reads as terms
  // rather than as part of the greeting
  return cancellationNotice ? withAddress + "\n\n" + cancellationNotice : withAddress;
}

/**
 * The late-cancellation notice, in the business's own words.
 *
 * {fee} stands in for the amount so the sentence survives a change of price.
 * Returns null when the notice is switched off, which is what keeps the
 * callers from having to know about the setting.
 */
export function buildCancellationNotice(
  settings:
    | Pick<AppSettings, "cancellation_notice" | "cancellation_fee_agorot" | "cancellation_notice_template">
    | null
    | undefined
): string | null {
  if (!settings || settings.cancellation_notice === false) return null;
  const body = settings.cancellation_notice_template?.trim() || DEFAULT_CANCELLATION_NOTICE;
  return body.replace(/\{fee\}/g, formatAgorotPlain(settings.cancellation_fee_agorot ?? 0));
}

// ---------------------------------------------------------------------------
// Confirming the call-out fee before anyone drives out
// ---------------------------------------------------------------------------

const DEFAULT_ORDER_CONFIRMATION = `שלום {customer},

להלן פרטי הזמנת השירות:

• כתובת השירות: {address}
• סוג התקלה: {issue}
• מועד הגעה משוער: {eta}

דמי הביקור והאבחון הם {fee}, כולל כל מס החל, והם משולמים עבור הגעת בעל המקצוע ובדיקת התקלה — גם אם לאחר הבדיקה תבחר/י שלא להזמין עבודה נוספת.

אם יהיה צורך בעבודה, חלקים או ציוד נוסף, המחיר יימסר לך בנפרד ויבוצע רק לאחר קבלת אישורך.

ניתן לבטל את ההזמנה ללא חיוב כל עוד הטכנאי טרם יצא לדרך. לאחר שהטכנאי יצא לדרך, ובמקרה של ביטול, אי־זמינות הלקוח או חוסר אפשרות לקבל גישה למקום, עשויים לחול דמי הביקור בסך {fee}, בכפוף להוראות חוק הגנת הצרכן ולכל זכות ביטול שאינה ניתנת להתניה.

לביטול או שינוי ניתן לפנות בטלפון או ב־WhatsApp למספר {phone}.

כדי לאשר את ההזמנה ואת יציאת הטכנאי, נא להשיב:
״{approval}״`;

const DEFAULT_ORDER_APPROVED = `שלום {customer}, ההזמנה אושרה ו{technician} יצא כעת לכתובת {address}.

זמן הגעה משוער: {eta}.

דמי הביקור והאבחון שאושרו הם {fee}. כל עבודה נוספת תתבצע רק לאחר הסבר וקבלת אישורך למחיר.

לשינוי או לביטול ניתן ליצור קשר מיידי במספר {phone}.`;

/** The built-in wording, so the settings screen can show what an empty box falls back to. */
export const ORDER_TEMPLATE_DEFAULTS = {
  confirmation: DEFAULT_ORDER_CONFIRMATION,
  approved: DEFAULT_ORDER_APPROVED,
};

type ConfirmationSettings = Pick<
  AppSettings,
  | "visit_fee_agorot"
  | "contact_whatsapp_phone"
  | "business_phone"
  | "eta_window_minutes"
  | "order_confirmation_template"
  | "order_approved_template"
>;

const VISIT_FEE_FALLBACK = 49900;

/**
 * The number a customer is told to call, and the one their confirmation goes to.
 *
 * Three fallbacks deep, because the feature has to work before anything has
 * been configured: its own setting, then the business phone the receipts
 * already use, then the number the business gave when this was built. Every
 * one of them is editable from the settings screen.
 */
export const SEED_CONTACT_PHONE = "054-828-2952";

export function contactPhone(settings: Partial<ConfirmationSettings> | null | undefined): string | null {
  return (
    settings?.contact_whatsapp_phone?.trim() ||
    settings?.business_phone?.trim() ||
    SEED_CONTACT_PHONE
  );
}

/**
 * Whether the database has caught up with this feature.
 *
 * The messages themselves need nothing new — they fall back to the built-in
 * wording and the standard fee — so the useful half works the moment the code
 * deploys. Only remembering who agreed, and editing the wording, need the
 * columns. Asking the object rather than a version number means this answers
 * itself correctly on a database that is half-updated.
 */
export function supportsOrderSettings(settings: object | null | undefined): boolean {
  return !!settings && "visit_fee_agorot" in settings;
}

/** The sentence the customer sends back. It names the fee, so it stands on its own. */
export function approvalSentence(settings: Partial<ConfirmationSettings> | null | undefined): string {
  const fee = formatAgorotPlain(settings?.visit_fee_agorot ?? VISIT_FEE_FALLBACK);
  return `אני מאשר/ת את פרטי ההזמנה ואת דמי הביקור והאבחון בסך ${fee}`;
}

/**
 * The one tap that turns "please reply" into a reply.
 *
 * A wa.me link addressed to the business, carrying the approval sentence
 * already typed: the customer taps it and only has to press send. Nothing is
 * asked of them that they could get wrong, and what comes back is their own
 * message, in writing, from their own number.
 */
export function buildConfirmReplyLink(settings: Partial<ConfirmationSettings> | null | undefined): string | null {
  return buildWhatsappLink(contactPhone(settings), approvalSentence(settings));
}

/**
 * Where the customer taps to agree.
 *
 * Their own page when the job carries a token and we know our address — one
 * tap, recorded by us, and they are shown straight away that the tradesperson
 * is coming. Otherwise the WhatsApp reply, which asks them to press send and
 * asks us to read it.
 */
export function buildConfirmLink(
  job: Pick<JobWithRelations, "confirm_token">,
  settings: Partial<ConfirmationSettings> | null | undefined,
  origin?: string | null
): string | null {
  const base = (origin ?? "").replace(/\/+$/, "");
  if (job.confirm_token && base) return `${base}/c/${job.confirm_token}`;
  return buildConfirmReplyLink(settings);
}

/** The app's own address, as the browser knows it. Empty on the server. */
export function siteOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

function fillCustomerTemplate(
  body: string,
  job: JobWithRelations,
  settings: Partial<ConfirmationSettings> | null | undefined
): string {
  const window = settings?.eta_window_minutes ?? 60;
  const eta = job.scheduled_at
    ? formatAppointmentWindowHe(job.scheduled_at, window)
    : "בהקדם — ניצור קשר לתיאום מדויק";
  const issue = [job.job_type?.name, job.notes?.trim()].filter(Boolean).join(" — ") || "לפי השיחה בטלפון";
  return body
    .replace(/\{customer\}/g, job.customer_name)
    .replace(/\{address\}/g, job.address_full ?? job.city?.name ?? "")
    .replace(/\{issue\}/g, issue)
    .replace(/\{eta\}/g, eta)
    .replace(/\{fee\}/g, formatAgorotPlain(settings?.visit_fee_agorot ?? VISIT_FEE_FALLBACK))
    .replace(/\{phone\}/g, contactPhone(settings) ?? "")
    .replace(/\{technician\}/g, job.profession?.technician_label?.trim() || "הטכנאי")
    .replace(/\{approval\}/g, approvalSentence(settings));
}

/**
 * The order as the customer will read it, ending in a tap that confirms it.
 *
 * The link is appended rather than required, so a business that rewrites the
 * wording cannot accidentally drop the only part that closes the loop. Putting
 * {confirm} in the template places it deliberately instead.
 */
export function buildOrderConfirmationMessage(
  job: JobWithRelations,
  settings: Partial<ConfirmationSettings> | null | undefined,
  origin?: string | null
): string {
  const body = settings?.order_confirmation_template?.trim() || DEFAULT_ORDER_CONFIRMATION;
  const filled = fillCustomerTemplate(body, job, settings);
  const link = buildConfirmLink(job, settings, origin);
  if (!link) return filled.replace(/\{confirm\}/g, "");
  if (/\{confirm\}/.test(body)) return filled.replace(/\{confirm\}/g, link);
  return `${filled}\n\nלאישור בלחיצה אחת:\n${link}`;
}

/** What the customer gets once they have confirmed and the tradesperson sets out. */
export function buildOrderApprovedMessage(
  job: JobWithRelations,
  settings: Partial<ConfirmationSettings> | null | undefined
): string {
  const body = settings?.order_approved_template?.trim() || DEFAULT_ORDER_APPROVED;
  return fillCustomerTemplate(body, job, settings);
}

export function buildCallLink(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function buildMapLink(job: Pick<JobWithRelations, "address_full" | "lat" | "lng" | "address_city">): string {
  if (job.lat && job.lng) {
    return `https://www.google.com/maps/search/?api=1&query=${job.lat},${job.lng}`;
  }
  const query = encodeURIComponent(job.address_full || job.address_city || "");
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}
