import type { AppSettings, Quote, QuoteLine } from "@/lib/types";
import { formatAgorot } from "@/lib/money";
import {
  formatQty,
  hasDiscount,
  lineTotal,
  plainDate,
  quoteDocTitle,
  quotePayable,
  workDoneLine,
} from "@/lib/quotes";

/**
 * The quote as a printable page.
 *
 * Drawn by the browser rather than laid out inside a PDF library, for the same
 * reason the receipt is: Hebrew is right-to-left and mixes with digits and ₪,
 * and getting that right by hand in a PDF is how documents end up with
 * reversed words and amounts. The browser already does it correctly, so it
 * draws the page and the PDF is a picture of what it drew.
 *
 * Width is A4 at 96dpi (794px) so the capture maps onto the page without
 * stretching, and the stylesheet is the receipt's with a few rows added — one
 * business, one look, whichever document arrives.
 */

/** Who the quote is from. The name may be the trade's; everything else is the business's. */
export interface QuoteBusiness {
  name: string | null;
  number: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export function quoteBusinessFrom(
  settings: Partial<AppSettings> | null | undefined,
  name: string | null
): QuoteBusiness {
  const pick = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
  return {
    name: pick(name) ?? pick(settings?.business_name),
    number: pick(settings?.business_number),
    address: pick(settings?.business_address),
    phone: pick(settings?.contact_whatsapp_phone) ?? pick(settings?.business_phone),
    email: pick(settings?.business_email),
  };
}

export function quoteHtml(
  quote: Quote,
  lines: QuoteLine[],
  biz: QuoteBusiness,
  subject: string | null
): string {
  const ordered = [...lines].sort((a, b) => a.sort_order - b.sort_order);
  const payable = quotePayable(quote);
  const discounted = hasDiscount(quote);
  const title = quoteDocTitle(quote.work_done);
  const done = workDoneLine(quote.work_done, { emoji: false });

  const row = (label: string, value: string | null) =>
    value ? `<tr><td class="k">${esc(label)}</td><td class="v">${esc(value)}</td></tr>` : "";

  // a quote priced as one figure has nothing to tabulate, and an empty table
  // with a single "שירות" row invented to fill it is worse than no table
  const itemsTable = ordered.length
    ? `
  <div class="section-title">פירוט</div>
  <table class="items">
    <thead>
      <tr>
        <th class="desc">תיאור</th>
        <th class="qty">כמות</th>
        <th class="amt">מחיר</th>
        <th class="amt">סה״כ</th>
      </tr>
    </thead>
    <tbody>
      ${ordered
        .map(
          (l) => `<tr>
        <td class="desc">${esc(l.description)}</td>
        <td class="qty">${esc(formatQty(l.qty))}</td>
        <td class="amt">${formatAgorot(l.unit_price_agorot)}</td>
        <td class="amt">${formatAgorot(lineTotal(l))}</td>
      </tr>`
        )
        .join("")}
    </tbody>
  </table>`
    : "";

  const subTotals = discounted
    ? `
  <table class="subtotals">
    <tr><td>סה״כ לפי הפירוט</td><td class="amt">${formatAgorot(quote.total_agorot)}</td></tr>
    <tr><td>הנחה</td><td class="amt">${formatAgorot(quote.total_agorot - payable)}</td></tr>
  </table>`
    : "";

  return `
<div class="sheet" dir="rtl">
  <div class="head">
    <div class="biz">
      <div class="biz-name">${esc(biz.name || title)}</div>
      ${biz.number ? `<div class="biz-line">ע.פ ${esc(biz.number)}</div>` : ""}
      ${biz.address ? `<div class="biz-line">${esc(biz.address)}</div>` : ""}
      ${biz.phone ? `<div class="biz-line">טלפון: ${esc(biz.phone)}</div>` : ""}
      ${biz.email ? `<div class="biz-line">${esc(biz.email)}</div>` : ""}
    </div>
    <div class="meta">
      <div class="title">${esc(title)}</div>
      <div class="num">מס׳ ${esc(quote.quote_number)}</div>
      <div class="date">${plainDate(quote.created_at)}</div>
    </div>
  </div>

  <div class="section-title">פרטי הלקוח</div>
  <table class="kv">
    ${row("שם", quote.customer_name)}
    ${row("ח.פ / ע.מ", quote.customer_tax_id)}
    ${row("טלפון", quote.customer_phone)}
    ${row("כתובת", quote.customer_address)}
  </table>

  ${subject ? `<div class="subject">${esc(subject)}</div>` : ""}
  ${itemsTable}
  ${subTotals}

  <div class="total">
    <span class="total-label">סה״כ לתשלום</span>
    <span class="total-value">${formatAgorot(payable)}</span>
  </div>

  ${done ? `<div class="state">${esc(done)}</div>` : ""}
  ${
    quote.valid_until && quote.work_done !== true
      ? `<div class="state">ההצעה בתוקף עד ${esc(plainDate(quote.valid_until))}.</div>`
      : ""
  }
  ${quote.notes?.trim() ? `<div class="notes">${esc(quote.notes.trim())}</div>` : ""}
</div>`;
}

export const QUOTE_CSS = `
.sheet {
  width: 794px; min-height: 1123px; box-sizing: border-box; padding: 56px 56px 72px;
  background: #fff; color: #10131a;
  font-family: "Segoe UI", "Arial Hebrew", Arial, system-ui, sans-serif;
  font-size: 15px; line-height: 1.6;
}
.head { display: flex; justify-content: space-between; align-items: flex-start;
        border-bottom: 3px solid #10131a; padding-bottom: 20px; margin-bottom: 28px; gap: 24px; }
.biz-name { font-size: 26px; font-weight: 800; margin-bottom: 6px; }
.biz-line { font-size: 13px; color: #4a5160; }
.meta { text-align: left; white-space: nowrap; }
.title { font-size: 30px; font-weight: 800; letter-spacing: 2px; }
.num { font-size: 16px; font-weight: 700; margin-top: 4px; }
.date { font-size: 13px; color: #4a5160; margin-top: 2px; }
.section-title { font-size: 12px; font-weight: 800; letter-spacing: 1px; color: #6b7280;
                 margin: 26px 0 8px; }
.kv { width: 100%; border-collapse: collapse; }
.kv .k { width: 110px; padding: 5px 0; color: #4a5160; font-size: 14px; vertical-align: top; }
.kv .v { padding: 5px 0; font-weight: 600; }
.subject { margin-top: 26px; padding: 12px 16px; background: #f4f5f8; border-radius: 10px;
           font-size: 17px; font-weight: 800; }
.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
.items th { text-align: right; font-size: 12px; color: #6b7280; font-weight: 700;
            border-bottom: 1px solid #d8dbe2; padding: 8px 0; }
.items th.amt, .items td.amt, .items th.qty, .items td.qty { text-align: left; white-space: nowrap; }
.items th.qty, .items td.qty { width: 70px; text-align: center; }
.items th.amt, .items td.amt { width: 110px; }
.items td { padding: 14px 0; border-bottom: 1px solid #eceef2; vertical-align: top; }
.items td.desc { font-weight: 600; }
.subtotals { width: 100%; border-collapse: collapse; margin-top: 14px; }
.subtotals td { padding: 4px 0; font-size: 14px; color: #4a5160; }
.subtotals td.amt { text-align: left; white-space: nowrap; font-weight: 600; }
.total { display: flex; justify-content: space-between; align-items: center;
         margin-top: 18px; padding: 16px 20px; background: #f4f5f8; border-radius: 10px; }
.total-label { font-size: 15px; font-weight: 700; }
.total-value { font-size: 24px; font-weight: 800; }
.state { margin-top: 12px; font-size: 14px; font-weight: 600; }
.notes { margin-top: 22px; padding-top: 16px; border-top: 1px solid #e3e6eb;
         font-size: 14px; color: #4a5160; white-space: pre-wrap; }
`;

function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}
