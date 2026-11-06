import type { LeakSurvey, LeakSurveyPhoto } from "@/lib/types";
import { plainDate } from "@/lib/quotes";
import { spotsLabel } from "@/lib/api/leaks";
import type { QuoteBusiness } from "@/lib/quote/render";

/**
 * The survey as a printable report.
 *
 * Built as a run of A4 pages rather than one tall sheet, because a survey of a
 * flat is a dozen photographs and a single page would either crop them or
 * shrink them to the point of proving nothing. Each page is captured and
 * added to the PDF in turn.
 *
 * The verdict goes on the first page, above the evidence. A customer told
 * there is a leak wants to know where before they read how it was found, and
 * a customer told there is none wants that sentence where they cannot miss it.
 */

export interface LeakPhotoForReport {
  photo: LeakSurveyPhoto;
  /** the photograph with its arrow already drawn in, as a data URL */
  dataUrl: string;
}

const PHOTOS_PER_PAGE = 2;

export function leakPageCount(photos: LeakPhotoForReport[], textPage: boolean): number {
  return 1 + (textPage ? 1 : 0) + Math.ceil(photos.length / PHOTOS_PER_PAGE);
}

/**
 * The written half of the report: what was found, what to do, and anything
 * else worth saying. Shared by the cover and the continuation page, so the
 * two can never drift apart.
 */
function writtenHtml(survey: LeakSurvey, photos: LeakPhotoForReport[]): string {
  const findings = photos.filter((p) => p.photo.marker_x != null);
  return `
  ${section("ממצאים", survey.summary)}
  ${section("המלצות", survey.recommendation)}
  ${
    findings.length
      ? `<div class="section-title">מוקדים שאותרו</div>
         <ol class="spots">
           ${findings
             .map(
               (f) =>
                 `<li><span class="spot-where">${esc(f.photo.location || "ללא מיקום")}</span>${
                   f.photo.caption ? ` — ${esc(f.photo.caption)}` : ""
                 }</li>`
             )
             .join("")}
         </ol>`
      : ""
  }
  ${section("הערות", survey.notes)}`;
}

/** Whether there is anything written at all. */
export function hasWritten(survey: LeakSurvey, photos: LeakPhotoForReport[]): boolean {
  return !!(
    survey.summary?.trim() ||
    survey.recommendation?.trim() ||
    survey.notes?.trim() ||
    photos.some((p) => p.photo.marker_x != null)
  );
}

/** The cover: who, where, when, and the answer. */
export function leakCoverHtml(
  survey: LeakSurvey,
  biz: QuoteBusiness,
  photos: LeakPhotoForReport[],
  /** false moves the written sections onto a page of their own */
  includeWritten = true
): string {
  const findings = photos.filter((p) => p.photo.marker_x != null);
  const verdict =
    survey.found === true
      ? {
          cls: "verdict found",
          head: `נמצאו ממצאי נזילה${findings.length ? ` · ${spotsLabel(findings.length)}` : ""}`,
          body:
            findings.length === 1
              ? "המוקד מסומן בחץ אדום על התמונה שבהמשך הדוח."
              : "המוקדים מסומנים בחץ אדום על התמונות שבהמשך הדוח.",
        }
      : survey.found === false
        ? {
            cls: "verdict clear",
            head: "לא נמצאו ממצאי נזילה",
            body: "הנכס נבדק במלואו בתאריך שלמעלה, ולא אותרו סימני נזילה או רטיבות.",
          }
        : {
            cls: "verdict open",
            head: "הבדיקה טרם הושלמה",
            body: "הדוח הופק לפני שנקבע ממצא סופי.",
          };

  return `
<div class="sheet" dir="rtl">
  <div class="head">
    <div class="biz">
      <div class="biz-name">${esc(biz.name || "דוח איתור נזילות")}</div>
      ${biz.number ? `<div class="biz-line">ע.פ ${esc(biz.number)}</div>` : ""}
      ${biz.address ? `<div class="biz-line">${esc(biz.address)}</div>` : ""}
      ${biz.phone ? `<div class="biz-line">טלפון: ${esc(biz.phone)}</div>` : ""}
      ${biz.email ? `<div class="biz-line">${esc(biz.email)}</div>` : ""}
    </div>
    <div class="meta">
      <div class="title">איתור נזילות</div>
      <div class="num">דוח מס׳ ${esc(survey.survey_number)}</div>
      <div class="date">${esc(plainDate(survey.surveyed_on))}</div>
    </div>
  </div>

  <div class="section-title">פרטי הבדיקה</div>
  <table class="kv">
    ${row("שם הלקוח", survey.customer_name)}
    ${row("כתובת הנכס", survey.customer_address)}
    ${row("טלפון", survey.customer_phone)}
    ${row("תאריך הבדיקה", plainDate(survey.surveyed_on))}
    ${row("מספר תמונות", String(photos.length))}
  </table>

  <div class="${verdict.cls}">
    <div class="verdict-head">${esc(verdict.head)}</div>
    <div class="verdict-body">${esc(verdict.body)}</div>
  </div>

  ${includeWritten ? writtenHtml(survey, photos) : ""}

  <div class="note">
    הדוח מתעד את שנמצא בבדיקה חזותית ובאמצעי האיתור שברשותנו, במועד ובמקומות שפורטו בלבד.
  </div>
</div>`;
}

/** The written sections on a page of their own, when the cover cannot hold them. */
export function leakTextPageHtml(
  survey: LeakSurvey,
  photos: LeakPhotoForReport[],
  pageNo: number,
  totalPages: number
): string {
  return `
<div class="sheet" dir="rtl">
  ${pageHeadHtml(survey, pageNo, totalPages)}
  ${writtenHtml(survey, photos)}
</div>`;
}

/** One page of photographs. */
function pageHeadHtml(survey: LeakSurvey, pageNo: number, totalPages: number): string {
  return `
  <div class="pagehead">
    <div class="pagehead-right">
      <span class="pagehead-title">איתור נזילות · דוח ${esc(survey.survey_number)}</span>
      <span class="pagehead-sub">${esc(survey.customer_name)}${
        survey.customer_address ? ` · ${esc(survey.customer_address)}` : ""
      }</span>
    </div>
    <span class="pagehead-num">עמוד ${pageNo} מתוך ${totalPages}</span>
  </div>`;
}

export function leakPhotoPageHtml(
  survey: LeakSurvey,
  page: LeakPhotoForReport[],
  pageIndex: number,
  pageNo: number,
  totalPages: number
): string {
  return `
<div class="sheet" dir="rtl">
  ${pageHeadHtml(survey, pageNo, totalPages)}

  ${page
    .map(
      ({ photo, dataUrl }, i) => `
  <figure class="shot">
    <img src="${dataUrl}" alt="" />
    <figcaption>
      <span class="shot-no">${i + 1 + pageIndex * PHOTOS_PER_PAGE}</span>
      <span class="shot-text">
        <strong>${esc(photo.location || (photo.marker_x != null ? "מוקד נזילה" : "תיעוד"))}</strong>
        ${photo.caption ? `<span class="shot-cap">${esc(photo.caption)}</span>` : ""}
      </span>
      ${
        photo.marker_x != null
          ? `<span class="shot-flag">מסומן בחץ</span>`
          : `<span class="shot-flag plain">ללא ממצא</span>`
      }
    </figcaption>
  </figure>`
    )
    .join("")}
</div>`;
}

/** Photographs split into pages, in report order. */
export function leakPhotoPages(photos: LeakPhotoForReport[]): LeakPhotoForReport[][] {
  const pages: LeakPhotoForReport[][] = [];
  for (let i = 0; i < photos.length; i += PHOTOS_PER_PAGE) {
    pages.push(photos.slice(i, i + PHOTOS_PER_PAGE));
  }
  return pages;
}

export const LEAK_CSS = `
.sheet {
  position: relative;
  width: 794px; height: 1123px; box-sizing: border-box; padding: 48px 48px 56px;
  background: #fff; color: #10131a;
  font-family: "Segoe UI", "Arial Hebrew", Arial, system-ui, sans-serif;
  font-size: 15px; line-height: 1.6; overflow: hidden;
}
.head { display: flex; justify-content: space-between; align-items: flex-start;
        border-bottom: 3px solid #10131a; padding-bottom: 18px; margin-bottom: 24px; gap: 24px; }
.biz-name { font-size: 25px; font-weight: 800; margin-bottom: 6px; }
.biz-line { font-size: 13px; color: #4a5160; }
.meta { text-align: left; white-space: nowrap; }
.title { font-size: 28px; font-weight: 800; letter-spacing: 1px; }
.num { font-size: 15px; font-weight: 700; margin-top: 4px; }
.date { font-size: 13px; color: #4a5160; margin-top: 2px; }
.section-title { font-size: 12px; font-weight: 800; letter-spacing: 1px; color: #6b7280;
                 margin: 22px 0 8px; }
.kv { width: 100%; border-collapse: collapse; }
.kv .k { width: 130px; padding: 5px 0; color: #4a5160; font-size: 14px; vertical-align: top; }
.kv .v { padding: 5px 0; font-weight: 600; }
.verdict { margin-top: 24px; padding: 18px 20px; border-radius: 12px; border-right: 6px solid; }
.verdict-head { font-size: 20px; font-weight: 800; }
.verdict-body { font-size: 14px; margin-top: 4px; }
.verdict.found { background: #fff1f2; border-color: #e11d2e; }
.verdict.found .verdict-head { color: #b3121f; }
.verdict.found .verdict-body { color: #7d1019; }
.verdict.clear { background: #f0fdf4; border-color: #16a34a; }
.verdict.clear .verdict-head { color: #15803d; }
.verdict.clear .verdict-body { color: #166534; }
.verdict.open { background: #f4f5f8; border-color: #9aa1ad; }
.verdict.open .verdict-head { color: #4a5160; }
.verdict.open .verdict-body { color: #6b7280; }
.para { font-size: 14px; white-space: pre-wrap; }
.spots { margin: 4px 0 0; padding-right: 20px; font-size: 14px; }
.spots li { padding: 3px 0; }
.spot-where { font-weight: 700; }
.note { position: absolute; right: 48px; left: 48px; bottom: 26px; padding-top: 12px;
         border-top: 1px solid #e3e6eb; font-size: 11px; color: #8a909c; }
.pagehead { display: flex; justify-content: space-between; align-items: baseline;
            border-bottom: 1px solid #d8dbe2; padding-bottom: 10px; margin-bottom: 18px; gap: 16px; }
.pagehead-right { display: flex; flex-direction: column; min-width: 0; }
.pagehead-title { font-size: 14px; font-weight: 800; }
.pagehead-sub { font-size: 12px; color: #4a5160; }
.pagehead-num { font-size: 12px; color: #6b7280; white-space: nowrap; }
.shot { margin: 0 0 16px; padding: 0; }
.shot img { display: block; width: 100%; height: 430px; object-fit: contain;
            background: #f4f5f8; border-radius: 10px; }
.shot figcaption { display: flex; align-items: flex-start; gap: 10px; margin-top: 8px; }
.shot-no { flex: 0 0 auto; width: 24px; height: 24px; border-radius: 50%; background: #10131a;
           color: #fff; font-size: 13px; font-weight: 800; text-align: center; line-height: 24px; }
.shot-text { flex: 1 1 auto; min-width: 0; font-size: 14px; }
.shot-cap { display: block; color: #4a5160; font-size: 13px; }
.shot-flag { flex: 0 0 auto; font-size: 12px; font-weight: 700; color: #b3121f;
             background: #fff1f2; border-radius: 999px; padding: 2px 10px; }
.shot-flag.plain { color: #4a5160; background: #f4f5f8; }
`;

function row(label: string, value: string | null): string {
  return value ? `<tr><td class="k">${esc(label)}</td><td class="v">${esc(value)}</td></tr>` : "";
}

function section(title: string, body: string | null): string {
  if (!body?.trim()) return "";
  return `<div class="section-title">${esc(title)}</div><div class="para">${esc(body.trim())}</div>`;
}

function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}
