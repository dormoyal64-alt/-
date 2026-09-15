import type { Receipt } from "@/lib/types";
import { receiptHtml, RECEIPT_CSS } from "./render";

export function receiptFileName(r: Receipt): string {
  return `קבלה-${r.receipt_number}-${r.customer_name}.pdf`.replace(/[\/\\:*?"<>|]/g, "-");
}

/**
 * Draws the receipt off-screen, photographs it, and wraps that in an A4 PDF.
 *
 * The node has to be attached and visible for fonts and layout to resolve —
 * html2canvas measures real boxes — so it is parked off the left edge instead
 * of hidden, and removed in a finally block so a failure cannot leave it behind.
 */
export async function receiptPdfBlob(r: Receipt): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const host = document.createElement("div");
  host.setAttribute("dir", "rtl");
  host.style.cssText = "position:fixed;top:0;left:-10000px;width:794px;background:#fff;z-index:-1;";
  host.innerHTML = `<style>${RECEIPT_CSS}</style>${receiptHtml(r)}`;
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
    // fit to width, and never let a tall render spill past the page
    const imgH = Math.min((canvas.height * pageW) / canvas.width, pageH);
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageW, imgH);
    return pdf.output("blob");
  } finally {
    host.remove();
  }
}

export type DeliveryResult = "shared" | "downloaded" | "cancelled";

/**
 * Hands the receipt to the customer.
 *
 * On a phone the share sheet takes a real file, so the PDF can go straight into
 * the WhatsApp chat with them — that is as close to "send it" as a web app gets
 * without a paid mail or messaging service behind it. Everywhere else it saves
 * the file, and the caller opens WhatsApp with a message so it can be attached.
 */
export async function deliverReceipt(r: Receipt): Promise<DeliveryResult> {
  const blob = await receiptPdfBlob(r);
  const name = receiptFileName(r);
  const file = new File([blob], name, { type: "application/pdf" });

  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: `קבלה ${r.receipt_number}` });
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
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
