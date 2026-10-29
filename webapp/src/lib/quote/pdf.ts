import type { Quote, QuoteLine } from "@/lib/types";
import { quoteDocTitle } from "@/lib/quotes";
import { QUOTE_CSS, quoteHtml, type QuoteBusiness } from "./render";

/**
 * The quote as a file the customer can keep.
 *
 * The same two steps the receipt uses, for the same reasons: the page is drawn
 * off-screen so fonts and right-to-left layout resolve against a real box, and
 * photographed into an A4 PDF. A quote that arrives as a document rather than
 * a wall of WhatsApp text is one a company can forward to its own accounts
 * department, and that is usually who decides whether the work happens.
 */

/**
 * What the file is called in the share sheet — the customer sees this one.
 *
 * Hebrew, because an Israeli customer receiving "quote-0059.pdf" has to open
 * it to know what it is.
 */
export function quoteFileName(q: Pick<Quote, "quote_number" | "customer_name" | "work_done">): string {
  return `${quoteDocTitle(q.work_done)}-${q.quote_number}-${q.customer_name}.pdf`.replace(
    /[\/\\:*?"<>|]/g,
    "-"
  );
}

/**
 * What the file is called when it is saved to disk instead.
 *
 * Deliberately ASCII. A download's name comes from the anchor's `download`
 * attribute, and Chromium throws the whole name away if any character in it is
 * non-ASCII — the file lands as "download", with no extension, and will not
 * open by double-clicking. Verified here: every Hebrew name tested, mixed or
 * not, came back as "download".
 *
 * So the saved copy is named by what survives — what it is and its number —
 * and the customer's name stays where it cannot be mangled, inside the
 * document. The share sheet is a different road and keeps the Hebrew name.
 */
export function quoteDownloadName(q: Pick<Quote, "quote_number" | "work_done">): string {
  return `${q.work_done === true ? "work-order" : "quote"}-${q.quote_number}.pdf`;
}

export async function quotePdfBlob(
  quote: Quote,
  lines: QuoteLine[],
  biz: QuoteBusiness,
  subject: string | null
): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const host = document.createElement("div");
  host.setAttribute("dir", "rtl");
  host.style.cssText = "position:fixed;top:0;left:-10000px;width:794px;background:#fff;z-index:-1;";
  host.innerHTML = `<style>${QUOTE_CSS}</style>${quoteHtml(quote, lines, biz, subject)}`;
  document.body.appendChild(host);

  try {
    const sheet = host.querySelector(".sheet") as HTMLElement;
    const canvas = await html2canvas(sheet, {
      scale: 2, // readable when printed, without making the file enormous
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
    });

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgH = Math.min((canvas.height * pageW) / canvas.width, pageH);
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageW, imgH);
    return pdf.output("blob");
  } finally {
    host.remove();
  }
}

export type DeliveryResult = "shared" | "downloaded" | "cancelled";

/** True on a device whose share sheet accepts a file — phones, essentially. */
export function canShareFiles(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({
      files: [new File([new Blob(["x"])], "x.pdf", { type: "application/pdf" })],
    });
  } catch {
    return false;
  }
}

/**
 * Hands the quote to the customer.
 *
 * On a phone the share sheet takes a real file, so the PDF goes straight into
 * the WhatsApp chat with them. Everywhere else it saves the file and the
 * caller opens WhatsApp so it can be attached by hand — no browser can put a
 * file into WhatsApp by itself.
 */
export async function deliverQuote(
  quote: Quote,
  lines: QuoteLine[],
  biz: QuoteBusiness,
  subject: string | null
): Promise<DeliveryResult> {
  const blob = await quotePdfBlob(quote, lines, biz, subject);
  const name = quoteFileName(quote);
  const file = new File([blob], name, { type: "application/pdf" });

  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({
        files: [file],
        title: `${quoteDocTitle(quote.work_done)} ${quote.quote_number}`,
      });
      return "shared";
    } catch (e) {
      // the user closing the share sheet is a choice, not a failure
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      // anything else: fall through and save the file instead
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = quoteDownloadName(quote);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
