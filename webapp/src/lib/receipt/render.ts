import type { Receipt } from "@/lib/types";
import { formatAgorot } from "@/lib/money";

/**
 * The receipt as HTML.
 *
 * It is drawn by the browser rather than laid out inside a PDF library on
 * purpose: Hebrew is right-to-left and mixes with digits and ₪, and getting
 * that right by hand in a PDF is how receipts end up with reversed words and
 * amounts. The browser already does it correctly, so it draws the page and the
 * PDF is a picture of what it drew.
 *
 * Width is A4 at 96dpi (794px) so the capture maps onto the page without
 * stretching.
 */
export function receiptHtml(r: Receipt): string {
  const issued = new Date(r.issued_at);
  // Pinned to Israel rather than the device: a receipt printed on a laptop set
  // to another timezone would otherwise carry a different hour — sometimes a
  // different date — from the same receipt printed on the phone.
  const TZ = "Asia/Jerusalem";
  const date = new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ }).format(issued);
  const time = new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(issued);

  const row = (label: string, value: string | null) =>
    value ? `<tr><td class="k">${esc(label)}</td><td class="v">${esc(value)}</td></tr>` : "";

  return `
<div class="sheet" dir="rtl">
  <div class="head">
    <div class="biz">
      <div class="biz-name">${esc(r.business_name || "קבלה")}</div>
      ${r.business_number ? `<div class="biz-line">ח.פ. / עוסק מורשה: ${esc(r.business_number)}</div>` : ""}
      ${r.business_address ? `<div class="biz-line">${esc(r.business_address)}</div>` : ""}
      ${r.business_phone ? `<div class="biz-line">טלפון: ${esc(r.business_phone)}</div>` : ""}
      ${r.business_email ? `<div class="biz-line">${esc(r.business_email)}</div>` : ""}
    </div>
    <div class="meta">
      <div class="title">קבלה</div>
      <div class="num">מס׳ ${esc(r.receipt_number)}</div>
      <div class="date">${date} · ${time}</div>
    </div>
  </div>

  <div class="section-title">פרטי הלקוח</div>
  <table class="kv">
    ${row("שם", r.customer_name)}
    ${row("טלפון", r.customer_phone)}
    ${row("כתובת", r.customer_address)}
  </table>

  <div class="section-title">פירוט</div>
  <table class="items">
    <thead><tr><th class="desc">תיאור</th><th class="amt">סכום</th></tr></thead>
    <tbody>
      <tr><td class="desc">${esc(r.description || "שירות")}</td><td class="amt">${formatAgorot(r.amount_agorot)}</td></tr>
    </tbody>
  </table>

  <div class="total">
    <span class="total-label">סה״כ שולם</span>
    <span class="total-value">${formatAgorot(r.amount_agorot)}</span>
  </div>
  ${r.payment_method_name ? `<div class="paid-by">אמצעי תשלום: ${esc(r.payment_method_name)}</div>` : ""}

  ${r.footer ? `<div class="footer">${esc(r.footer)}</div>` : ""}
</div>`;
}

export const RECEIPT_CSS = `
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
.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
.items th { text-align: right; font-size: 12px; color: #6b7280; font-weight: 700;
            border-bottom: 1px solid #d8dbe2; padding: 8px 0; }
.items th.amt, .items td.amt { text-align: left; white-space: nowrap; }
.items td { padding: 14px 0; border-bottom: 1px solid #eceef2; }
.items td.desc { font-weight: 600; }
.total { display: flex; justify-content: space-between; align-items: center;
         margin-top: 22px; padding: 16px 20px; background: #f4f5f8; border-radius: 10px; }
.total-label { font-size: 15px; font-weight: 700; }
.total-value { font-size: 24px; font-weight: 800; }
.paid-by { margin-top: 10px; font-size: 13px; color: #4a5160; }
.footer { margin-top: 44px; padding-top: 16px; border-top: 1px solid #e3e6eb;
          font-size: 13px; color: #4a5160; text-align: center; white-space: pre-wrap; }
`;

function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}
