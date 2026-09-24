"use client";

import { useState } from "react";
import { HardDriveDownload, Loader2, ShieldAlert } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";

/**
 * The copy the business keeps for itself.
 *
 * Supabase's free plan takes no backups, and none of their plans back up the
 * photographed receipts — so without this there is no second copy of the books
 * anywhere. One button, one file, and a sentence saying where to put it,
 * because a backup that needs explaining is a backup that does not get taken.
 */
export function BackupCard() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [lastAt, setLastAt] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    try {
      const response = await fetch("/api/backup");
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        toast.error(detail?.error ?? "הגיבוי נכשל. נסו שוב.");
        return;
      }
      const blob = await response.blob();
      const stamp = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `גיבוי-מערכת-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setLastAt(new Date().toLocaleString("he-IL"));
      toast.success("הגיבוי ירד למכשיר");
    } catch {
      toast.error("אין חיבור לרשת");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-2 border-warning-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDriveDownload className="h-5 w-5 text-warning-600" /> גיבוי הנתונים
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="flex items-start gap-2 rounded-xl bg-warning-50 px-3.5 py-3 text-sm font-semibold text-warning-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Supabase בתוכנית החינמית <b>לא שומרת שום גיבוי אוטומטי</b>, וגם בתוכנית בתשלום היא
            לא מגבה את תמונות הקבלות. הקובץ הזה הוא הגיבוי היחיד שלכם.
          </span>
        </div>

        <p className="text-sm text-ink-500">
          מוריד קובץ אחד עם <b>כל</b> הנתונים: העבודות, הקבלות, ההוצאות, הקבלנים וההתחשבנויות —
          וגם את תמונות הקבלות שצילמתם. בפנים יש גם קבצי CSV שנפתחים באקסל.
        </p>

        <button
          onClick={download}
          disabled={busy}
          className="btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <HardDriveDownload className="h-5 w-5" />}
          {busy ? "אוסף את הנתונים..." : "הורדת גיבוי מלא"}
        </button>

        {lastAt && <p className="text-center text-xs font-bold text-success-700">הגיבוי האחרון ירד ב-{lastAt}</p>}

        <p className="text-xs text-ink-400">
          שמרו את הקובץ <b>מחוץ ל-Supabase</b> — בגוגל דרייב, בדיסק חיצוני, או בשניהם. כדאי
          להוריד גיבוי פעם בשבוע, ותמיד לפני שינוי גדול.
        </p>
      </CardBody>
    </Card>
  );
}
