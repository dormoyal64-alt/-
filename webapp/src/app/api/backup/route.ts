import { NextResponse } from "next/server";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/server";
import { RECEIPTS_BUCKET } from "@/lib/api/expenseReceipts";
import { toCsv } from "@/lib/csv";

/**
 * Everything, in one file you can keep.
 *
 * Supabase's free plan takes no backups at all, and no plan of theirs backs
 * up the Storage bucket — so the photographed receipts are not covered even
 * on a paid one. That makes the only real safeguard a copy the business holds
 * itself, somewhere that is not Supabase.
 *
 * It is deliberately one button and one file. A backup that takes a command
 * line, a login and three steps is a backup nobody takes, and an untaken
 * backup is the same as no backup at all.
 *
 * The JSON is the authoritative copy — every column of every row, exactly as
 * stored, which is what a restore needs. The CSVs are there so the business
 * can open its own books in Excel without asking anyone for help, which is
 * the other thing a backup is for.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// a few hundred photographs take a while to gather
export const maxDuration = 300;

/** Every table the business's own data lives in. */
const TABLES = [
  "app_settings", "profiles",
  "jobs", "job_status_history", "job_expenses", "receipts",
  "contractors", "contractor_professions", "contractor_job_types",
  "contractor_cities", "contractor_hours", "contractor_receipts",
  "helpers", "settlements",
  "business_expenses", "expense_categories", "expense_receipts", "ad_spend",
  "professions", "job_types", "job_statuses", "payment_methods",
  "lead_sources", "referral_companies", "cities", "city_distances",
  "notifications",
  "agent_conversations", "agent_messages", "agent_actions", "agent_usage",
];

/** The tables worth opening in a spreadsheet, and the order a person reads them. */
const AS_CSV = ["jobs", "receipts", "business_expenses", "job_expenses", "contractor_receipts", "contractors", "settlements"];

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "לא מחוברים למערכת" }, { status: 401 });

  const zip = new JSZip();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const counts: Record<string, number | string> = {};

  for (const table of TABLES) {
    // a table that does not exist yet is not a failure — the business may not
    // have run every migration, and the rest of the backup still matters
    const { data, error } = await supabase.from(table).select("*");
    if (error) {
      counts[table] = `לא נקרא: ${error.message}`;
      continue;
    }
    const rows = (data as Record<string, unknown>[]) ?? [];
    counts[table] = rows.length;
    zip.file(`data/${table}.json`, JSON.stringify(rows, null, 2));

    if (AS_CSV.includes(table) && rows.length > 0) {
      const columns = Object.keys(rows[0]).map((k) => ({ key: k, label: k }));
      zip.file(`spreadsheets/${table}.csv`, toCsv(rows, columns));
    }
  }

  // the photographs, which no Supabase plan backs up
  let photos = 0;
  let photoNote = "";
  try {
    const { data: files } = await supabase
      .from("expense_receipts")
      .select("storage_path, file_name");
    for (const row of ((files as { storage_path: string; file_name: string | null }[]) ?? [])) {
      const { data: blob } = await supabase.storage.from(RECEIPTS_BUCKET).download(row.storage_path);
      if (!blob) continue;
      zip.file(`receipts/${row.storage_path}`, Buffer.from(await blob.arrayBuffer()));
      photos += 1;
    }
  } catch (e) {
    photoNote = e instanceof Error ? e.message : String(e);
  }

  zip.file(
    "קרא-אותי.txt",
    [
      "גיבוי מלא של מערכת ניהול העבודות",
      `נוצר: ${new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}`,
      "",
      "מה יש כאן",
      "  data/        — כל הנתונים, טבלה־טבלה, בפורמט JSON. זה העותק המלא,",
      "                 וזה מה שצריך כדי לשחזר את המערכת.",
      "  spreadsheets/ — העבודות, הקבלות וההוצאות כקבצי CSV שנפתחים באקסל.",
      "  receipts/    — התמונות של הקבלות שצילמתם.",
      "",
      "חשוב לדעת",
      "  Supabase בתוכנית החינמית לא שומרת שום גיבוי אוטומטי,",
      "  וגם בתוכנית בתשלום היא לא מגבה את תמונות הקבלות.",
      "  הקובץ הזה הוא הגיבוי היחיד שלכם — שמרו אותו מחוץ ל-Supabase:",
      "  בגוגל דרייב, בדיסק חיצוני, או בשניהם.",
      "",
      "כמה שורות נשמרו",
      ...Object.entries(counts).map(([t, n]) => `  ${t}: ${n}`),
      `  תמונות קבלות: ${photos}${photoNote ? ` (שגיאה: ${photoNote})` : ""}`,
      "",
      "הקוד של התוכנה עצמה שמור ב-GitHub ולא בקובץ הזה.",
    ].join("\n")
  );

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="jobcrm-backup-${stamp}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
