import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeakSurveyWithPhotos } from "@/lib/types";
import type { QuoteBusiness } from "@/lib/quote/render";
import { orderedPhotos, photoBlob } from "@/lib/api/leaks";
import { annotatedPhotoUrl } from "./annotate";
import {
  LEAK_CSS,
  hasWritten,
  leakCoverHtml,
  leakPageCount,
  leakPhotoPageHtml,
  leakPhotoPages,
  leakTextPageHtml,
  type LeakPhotoForReport,
} from "./render";

export type DeliveryResult = "shared" | "downloaded" | "cancelled";

/** ASCII, because Chromium discards a download filename that is not. */
export function leakDownloadName(survey: { survey_number: string }): string {
  return `leak-survey-${survey.survey_number}.pdf`;
}

/** What the customer sees in the share sheet. */
export function leakFileName(survey: {
  survey_number: string;
  customer_name: string;
}): string {
  return `איתור נזילות-${survey.survey_number}-${survey.customer_name}.pdf`.replace(
    /[\/\\:*?"<>|]/g,
    "-"
  );
}

/**
 * Every photograph of the survey, downloaded and with its arrow drawn in.
 *
 * Done once, before any page is laid out, so a photograph that cannot be read
 * fails here rather than halfway through building a PDF — and so the same
 * annotated image can be reused if the report is built twice.
 */
export async function prepareLeakPhotos(
  supabase: SupabaseClient,
  survey: LeakSurveyWithPhotos,
  onProgress?: (done: number, total: number) => void
): Promise<LeakPhotoForReport[]> {
  const photos = orderedPhotos(survey);
  const out: LeakPhotoForReport[] = [];
  for (const photo of photos) {
    const blob = await photoBlob(supabase, photo.storage_path);
    const marker =
      photo.marker_x != null && photo.marker_y != null
        ? { x: Number(photo.marker_x), y: Number(photo.marker_y) }
        : null;
    out.push({ photo, dataUrl: await annotatedPhotoUrl(blob, marker) });
    onProgress?.(out.length, photos.length);
  }
  return out;
}

/**
 * The survey as a PDF of A4 pages.
 *
 * Each page is drawn off-screen and photographed in turn, rather than one
 * tall sheet sliced up: a slice lands wherever it lands, and a report whose
 * page break runs through the middle of the photograph proving the leak is
 * not a report. Laying out the pages means every break is a chosen one.
 */
export async function leakPdfBlob(
  survey: LeakSurveyWithPhotos,
  biz: QuoteBusiness,
  photos: LeakPhotoForReport[]
): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const host = document.createElement("div");
  host.setAttribute("dir", "rtl");
  host.style.cssText = "position:fixed;top:0;left:-10000px;width:794px;background:#fff;z-index:-1;";
  document.body.appendChild(host);

  try {
    // Does everything fit on the cover?
    //
    // The written sections are free text of no fixed length — a survey where
    // the owner has a paragraph to say about the neighbour's balcony is a
    // normal survey — and the page is a fixed 1123px with overflow hidden.
    // Silently cutting the end off a document that goes to a customer is the
    // worst thing this could do, so the cover is measured before it is used,
    // and the writing moves to a page of its own when it does not fit.
    //
    // Measured with the page's own height lifted, because a box fixed at
    // 1123px never reports a scrollHeight below that — the first version of
    // this check was always true, and every report got a continuation page it
    // did not need.
    const PAGE_H = 1123;
    // the disclaimer sits absolutely at the foot, so the writing has to stop
    // short of it rather than merely reach the page edge
    const ROOM = PAGE_H - 56;
    host.innerHTML =
      `<style>${LEAK_CSS}.sheet{height:auto !important;min-height:0 !important}</style>` +
      leakCoverHtml(survey, biz, photos, true);
    const probe = host.querySelector(".sheet") as HTMLElement;
    const written = hasWritten(survey, photos);
    const textPage = written && probe.offsetHeight > ROOM;

    const total = leakPageCount(photos, textPage);
    let pageNo = 1;
    const pages = [
      leakCoverHtml(survey, biz, photos, !textPage),
      ...(textPage ? [leakTextPageHtml(survey, photos, ++pageNo, total)] : []),
      ...leakPhotoPages(photos).map((page, i) =>
        leakPhotoPageHtml(survey, page, i, ++pageNo, total)
      ),
    ];

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    for (let i = 0; i < pages.length; i++) {
      host.innerHTML = `<style>${LEAK_CSS}</style>${pages[i]}`;
      const sheet = host.querySelector(".sheet") as HTMLElement;
      // the photographs are data URLs, which decode asynchronously; without
      // this the first capture can catch an empty box where the evidence goes
      await Promise.all(
        Array.from(host.querySelectorAll("img")).map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((done) => {
                img.onload = () => done();
                img.onerror = () => done();
              })
        )
      );
      const canvas = await html2canvas(sheet, {
        scale: 2,
        backgroundColor: "#ffffff",
        logging: false,
        useCORS: true,
      });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, pageW, pageH);
    }

    return pdf.output("blob");
  } finally {
    host.remove();
  }
}

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

/** Hands the report to the customer: the share sheet on a phone, a file otherwise. */
export async function deliverLeakReport(
  survey: LeakSurveyWithPhotos,
  biz: QuoteBusiness,
  photos: LeakPhotoForReport[]
): Promise<DeliveryResult> {
  const blob = await leakPdfBlob(survey, biz, photos);
  const file = new File([blob], leakFileName(survey), { type: "application/pdf" });

  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: `איתור נזילות ${survey.survey_number}` });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = leakDownloadName(survey);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
