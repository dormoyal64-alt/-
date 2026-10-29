import type { AppSettings, Profession, Quote, QuoteLine, QuoteStatus } from "@/lib/types";
import { formatAgorotPlain } from "@/lib/money";
import { contactPhone } from "@/lib/whatsapp";

/**
 * A quote, and the message the customer receives.
 *
 * The whole point of a written quote is that both sides end up holding the same
 * text, so the message is built from the quote's own rows rather than typed
 * anywhere: what the customer reads on WhatsApp is the same breakdown the
 * business can open six months later and defend.
 *
 * Amounts use formatAgorotPlain throughout. The Hebrew currency format carries
 * invisible bidi marks that survive into the message and its URL encoding, and
 * a price a customer agreed to should be exactly the characters it looks like.
 */

/** How long a quote holds, in days, as the form offers it. */
export const VALIDITY_CHOICES = [7, 14, 30, 60] as const;

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "טיוטה",
  sent: "נשלחה",
  accepted: "אושרה",
  declined: "נדחתה",
  expired: "פג תוקף",
};

/** What one line comes to. Rounded in the same direction as the database does it. */
export function lineTotal(line: Pick<QuoteLine, "qty" | "unit_price_agorot">): number {
  return Math.round(line.qty * line.unit_price_agorot);
}

export function quoteTotal(lines: Pick<QuoteLine, "qty" | "unit_price_agorot">[]): number {
  return lines.reduce((sum, l) => sum + lineTotal(l), 0);
}

/**
 * What the customer is actually asked to pay.
 *
 * The lines are what the work is made of; this is what was agreed. Usually
 * they are the same number and nothing is gained by distinguishing them — but
 * when a price is simply said out loud, or the lines come to 1,630 and the
 * figure given is 1,500, this is the one that is owed. Everything that totals
 * money on a quote reads it from here, so there is one answer to "how much is
 * this quote for" rather than one per screen.
 */
export function quotePayable(
  quote: Pick<Quote, "total_agorot" | "final_total_agorot">
): number {
  return quote.final_total_agorot ?? quote.total_agorot;
}

/** True when a price was agreed that the breakdown does not add up to. */
export function hasDiscount(
  quote: Pick<Quote, "total_agorot" | "final_total_agorot">
): boolean {
  return quote.final_total_agorot != null && quote.total_agorot > 0 && quote.final_total_agorot !== quote.total_agorot;
}

/** What the quote says about when the work happens. Null says nothing. */
export function workDoneLine(workDone: boolean | null | undefined): string | null {
  if (workDone == null) return null;
  return workDone ? "✅ העבודה כבר בוצעה." : "העבודה טרם בוצעה.";
}

/** 3 rather than 3.00, but 3.5 kept as 3.5. */
export function formatQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(2)));
}

/** A plain d.m.yyyy, built without Intl so no bidi marks reach the message. */
export function plainDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso.length <= 10 ? iso + "T12:00:00" : iso) : iso;
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

/** The day a quote stops holding, N days from today. */
export function validUntilFrom(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whether a quote's own date has passed, whatever its stored status says. */
export function isExpired(q: Pick<Quote, "valid_until" | "status" | "work_done">): boolean {
  // work already done cannot expire: the document states a price for something
  // that happened, not an offer the customer still has to take up
  if (q.work_done === true) return false;
  if (!q.valid_until || q.status === "accepted" || q.status === "declined") return false;
  const end = new Date(q.valid_until + "T23:59:59");
  return end.getTime() < Date.now();
}

type QuoteSettings = Partial<
  Pick<
    AppSettings,
    | "business_name"
    | "business_number"
    | "business_phone"
    | "contact_whatsapp_phone"
    | "vat_status"
    | "prices_include_tax"
  >
>;

/**
 * What the quote says about tax.
 *
 * An עוסק פטור charges no VAT at all, and a customer who expects a number
 * plus 18% should be told so in the quote rather than when the receipt arrives.
 * Silence here is the thing that causes the argument.
 */
export function taxNote(settings: QuoteSettings | null | undefined): string {
  if (!settings || settings.vat_status === "exempt" || settings.vat_status == null) {
    return "עוסק פטור — אין חיוב מע״מ והמחיר הוא המחיר הסופי.";
  }
  return settings.prices_include_tax
    ? "המחירים כוללים מע״מ."
    : "למחירים יתווסף מע״מ כחוק.";
}

/**
 * Whose name heads this quote.
 *
 * One עוסק פטור, one ע.פ — that is fixed, and it is the same on a plumbing
 * job and an electrical one. The name is not. A customer who asks for a price
 * on an electrical board and gets it back from "ביוביות בדרום" reads it as a
 * wrong number, and the quote is lost before the price was ever considered.
 *
 * So three levels, the same ladder the call-out fee uses: this quote's own
 * answer, then the trade's, then the business's standing name. Each is
 * consulted only when the one before it has nothing to say, which is what lets
 * one name cover a whole trade while a single quote overrides it.
 *
 * A quote is not a tax document, which is the only reason this is allowed to
 * exist. A receipt must carry the registered name and goes nowhere near here.
 */
export function quoteBusinessName(
  quote: Pick<Quote, "business_name_override"> | null | undefined,
  profession: Pick<Profession, "quote_business_name"> | null | undefined,
  settings: QuoteSettings | null | undefined
): string | null {
  return (
    quote?.business_name_override?.trim() ||
    profession?.quote_business_name?.trim() ||
    settings?.business_name?.trim() ||
    null
  );
}

/**
 * The business's own sign-off, at the foot of every quote.
 *
 * Name and ע.פ, because a price quoted by a nameless WhatsApp number is not
 * something a customer — least of all a company or a school — can put through
 * their own books. The phone goes with it so the answer has somewhere to go.
 *
 * The name can change per trade; the ע.פ and the phone never do, because there
 * is one business behind all of them and that is what a customer's accountant
 * will check.
 */
export function quoteSignature(
  settings: QuoteSettings | null | undefined,
  name?: string | null
): string[] {
  const phone = contactPhone(settings);
  return [
    (name ?? settings?.business_name)?.trim() || null,
    settings?.business_number?.trim() ? `ע.פ ${settings.business_number.trim()}` : null,
    phone ? `טל׳ ${phone}` : null,
  ].filter((l): l is string => !!l);
}

/**
 * The quote as the customer will read it on WhatsApp.
 *
 * Ordered the way a customer reads a price: what it is for, then every line and
 * what it costs, then the total, then how long it holds — and the business's
 * own name and ע.פ last, so the message can be forwarded to an accountant and
 * still say who it came from.
 */
export function buildQuoteWhatsappMessage(
  quote: Quote,
  lines: QuoteLine[],
  settings: QuoteSettings | null | undefined,
  context?: {
    professionName?: string | null;
    jobTypeName?: string | null;
    /** the trade this quote is for, for the name at its head and foot */
    profession?: Pick<Profession, "quote_business_name"> | null;
  }
): string {
  const ordered = [...lines].sort((a, b) => a.sort_order - b.sort_order);
  const businessName = quoteBusinessName(quote, context?.profession, settings);
  const subject =
    quote.title?.trim() ||
    [context?.professionName, context?.jobTypeName].filter(Boolean).join(" — ") ||
    null;

  const parts: (string | null)[] = [
    `*הצעת מחיר ${quote.quote_number}*`,
    businessName ? `מאת ${businessName}` : null,
    "",
    `לכבוד ${quote.customer_name}`,
    quote.customer_tax_id?.trim() ? `ח.פ / ע.מ ${quote.customer_tax_id.trim()}` : null,
    quote.customer_address?.trim() ? `כתובת: ${quote.customer_address.trim()}` : null,
    `תאריך: ${plainDate(quote.created_at)}`,
    "",
    subject ? `*${subject}*` : null,
    subject ? "" : null,
  ];

  for (const line of ordered) {
    const total = lineTotal(line);
    parts.push(
      // a colon rather than a dash before the price: descriptions carry
      // dashes of their own, and "שטיפת קו — ביוב — 760 ₪" is unreadable
      line.qty === 1
        ? `• ${line.description}: ${formatAgorotPlain(total)}`
        : `• ${line.description}: ${formatQty(line.qty)} × ${formatAgorotPlain(
            line.unit_price_agorot
          )} = ${formatAgorotPlain(total)}`
    );
  }

  const payable = quotePayable(quote);
  const discounted = hasDiscount(quote);

  parts.push(
    "",
    // the breakdown's own sum, shown only when the agreed price is not it —
    // a customer whose lines add to 1,630 and whose total reads 1,500 should
    // be shown the discount, not left to find the arithmetic error
    discounted ? `סה״כ לפי הפירוט: ${formatAgorotPlain(quote.total_agorot)}` : null,
    discounted ? `הנחה: ${formatAgorotPlain(quote.total_agorot - payable)}` : null,
    `*סה״כ לתשלום: ${formatAgorotPlain(payable)}*`,
    "",
    workDoneLine(quote.work_done),
    // a price for work already finished is not an offer waiting to be taken
    // up, so it is not given a date it expires on
    quote.valid_until && quote.work_done !== true
      ? `ההצעה בתוקף עד ${plainDate(quote.valid_until)}.`
      : null,
    taxNote(settings),
    quote.notes?.trim() ? "" : null,
    quote.notes?.trim() ? quote.notes.trim() : null,
    "",
    ...quoteSignature(settings, businessName)
  );

  // Collapse the runs of blank lines the optional parts leave behind, so a
  // quote with no address does not arrive with a hole in the middle of it.
  return parts
    .filter((p) => p !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
