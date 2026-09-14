"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { UserCog, ShieldCheck, ClipboardList, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { PageSpinner } from "@/components/ui/Misc";
import type { Profile } from "@/lib/types";

const ROLES: { key: "owner" | "clerk"; label: string; hint: string }[] = [
  { key: "owner", label: "בעל העסק", hint: "רואה הכל — רווחים, דוחות, התחשבנויות" },
  { key: "clerk", label: "פקידה", hint: "עבודות וקבלנים בלבד, בלי נתונים כספיים" },
];

export default function UsersPage() {
  const supabase = useMemo(() => createClient(), []);
  const { profile, refresh } = useRefData();
  const toast = useToast();
  const [rows, setRows] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("profiles").select("*").order("created_at");
    setRows((data as Profile[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function setRole(id: string, role: "owner" | "clerk") {
    // Losing the last owner would lock the money out of the business for good,
    // and nothing else in the app could put it back.
    if (role === "clerk" && rows.filter((r) => r.role === "owner").length <= 1) {
      toast.error("חייב להישאר לפחות בעל עסק אחד");
      return;
    }
    if (id === profile?.id && role === "clerk") {
      toast.error("אי אפשר להוריד הרשאות לעצמכם. בקשו ממשתמש אחר, או שנו קודם מישהו אחר לבעל עסק.");
      return;
    }
    setSaving(id);
    const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
    setSaving(null);
    if (error) return toast.error("שגיאה בשמירת ההרשאה");
    await load();
    await refresh();
    toast.success(role === "owner" ? "המשתמש הוגדר כבעל עסק" : "המשתמש הוגדר כפקידה");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900">משתמשים והרשאות</h1>
        <p className="text-sm text-ink-500">מי נכנס למערכת, ומה כל אחד רואה</p>
      </div>

      <Card className="border-2 border-brand-100 bg-brand-50/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-brand-600" /> איך מוסיפים משתמש חדש
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm text-ink-700">
          <p>יצירת החשבון עצמו נעשית ב-Supabase, בדיוק כמו שיצרתם את החשבון שלכם:</p>
          <ol className="mr-4 list-decimal space-y-1 text-ink-600">
            <li>נכנסים ל-supabase.com ← הפרויקט ← <b>Authentication</b> (אייקון מנעול) ← <b>Users</b></li>
            <li><b>Add user</b> ← <b>Create new user</b></li>
            <li>ממלאים אימייל וסיסמה, ומסמנים <b>Auto Confirm User</b></li>
            <li>המשתמש יופיע כאן ברשימה אחרי הכניסה הראשונה שלו למערכת</li>
          </ol>
          <p className="text-xs text-ink-500">
            כל חשבון חדש נוצר אוטומטית כ<b>פקידה</b>. הרשאת בעל עסק ניתנת רק מכאן, בכוונה.
          </p>
        </CardBody>
      </Card>

      {loading ? (
        <PageSpinner />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5 text-ink-400" /> {rows.length} משתמשים
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="rounded-2xl border border-ink-100 p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  {r.role === "owner" ? (
                    <ShieldCheck className="h-[18px] w-[18px] shrink-0 text-success-600" />
                  ) : (
                    <ClipboardList className="h-[18px] w-[18px] shrink-0 text-ink-400" />
                  )}
                  <p className="font-bold text-ink-900">{r.full_name || r.email || "ללא שם"}</p>
                  {r.id === profile?.id && <span className="badge bg-brand-50 text-brand-700">זה אתם</span>}
                </div>
                {r.email && r.full_name && <p className="mt-0.5 text-xs text-ink-400" dir="ltr">{r.email}</p>}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {ROLES.map((role) => (
                    <button
                      key={role.key}
                      type="button"
                      onClick={() => setRole(r.id, role.key)}
                      disabled={saving === r.id || r.role === role.key}
                      className={`rounded-xl border px-3 py-2 text-right text-sm font-semibold transition disabled:cursor-default ${
                        r.role === role.key
                          ? "border-brand-600 bg-brand-600 text-white"
                          : "border-ink-200 text-ink-600 hover:bg-ink-50"
                      }`}
                    >
                      <span className="block">{role.label}</span>
                      <span className={`block text-[11px] font-normal ${r.role === role.key ? "text-white/80" : "text-ink-400"}`}>
                        {role.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>מה פקידה לא רואה</CardTitle>
        </CardHeader>
        <CardBody className="space-y-1.5 text-sm text-ink-600">
          <p>• רווח נקי, אנליטיקס, סיכומים, התחשבנות, דירוג קבלנים</p>
          <p>• הוצאות פרסום וחברות מפנות</p>
          <p>• עבודות סגורות — ואיתן המחיר הסופי, חלק הקבלן והחלק שלכם</p>
          <p>• סגירת עבודה (הזנת הסכום הסופי)</p>
          <p className="pt-1.5 text-xs text-ink-400">
            החסימה היא במסד הנתונים עצמו, לא רק בתפריט — גם כניסה ישירה לכתובת או פנייה ישירה
            ל-API מחזירה אפס.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
