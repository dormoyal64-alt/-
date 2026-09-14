import type { JobWithRelations } from "@/lib/types";
import { formatAgorot } from "@/lib/money";

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
    `שם לקוח: ${job.customer_name}`,
    // Withholding the number without saying so just leaves the contractor
    // hunting for it, so the message says where to get the customer instead.
    withPhone ? `טלפון לקוח: ${job.customer_phone}` : "טלפון לקוח: לתיאום מול הלקוח — דברו איתי",
    job.city?.name ? `עיר: ${job.city.name}` : null,
    job.address_full ? `כתובת: ${job.address_full}` : null,
    job.quoted_price_agorot ? `מחיר שנאמר בטלפון: ${formatAgorot(job.quoted_price_agorot)}` : null,
    job.payment_method?.name ? `אמצעי תשלום: ${job.payment_method.name}` : null,
    job.notes ? `הערות: ${job.notes}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

const DEFAULT_ON_THE_WAY =
  "שלום {customer}, {technician} כבר בדרך אליך 🚚\nנא להיות זמין/ה לקבלת השירות.\nתודה!";

// Tells the customer the tradesperson is on the way, in the wording that fits
// this profession ("טכנאי האינסטלציה" / "החשמלאי" / "המנעולן"...).
export function buildOnTheWayMessage(job: JobWithRelations, template?: string | null): string {
  const technician = job.profession?.technician_label?.trim() || "הטכנאי";
  const body = (template && template.trim()) || DEFAULT_ON_THE_WAY;
  const filled = body
    .replace(/\{technician\}/g, technician)
    .replace(/\{customer\}/g, job.customer_name)
    .replace(/\{address\}/g, job.address_full ?? job.city?.name ?? "");
  // only append the address when the template did not already place it
  if (!/\{address\}/.test(body) && job.address_full) return filled + "\nכתובת: " + job.address_full;
  return filled;
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
