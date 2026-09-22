"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Receipt, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatAgorot, shekelsToAgorot } from "@/lib/money";
import { errorMessage } from "@/lib/errors";
import type { JobExpense } from "@/lib/types";

/**
 * What this job cost to do, beyond fuel and a helper.
 *
 * Parts, a skip, a crane, parking — money that left the business for one job
 * and used to appear in no report at all. Each line is its own row so the job
 * can be read back later and say where the money went, rather than carrying
 * one lump nobody can account for.
 */
export function JobExpensesCard({ jobId, onChange }: { jobId: string; onChange?: (total: number) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [rows, setRows] = useState<JobExpense[]>([]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [supported, setSupported] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("job_expenses")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at");
    // the table arrives with a migration; until then the card stays out of the way
    if (error) return setSupported(false);
    const list = (data ?? []) as JobExpense[];
    setRows(list);
    onChange?.(list.reduce((sum, r) => sum + r.amount_agorot, 0));
    // onChange is recreated on every render of the parent; depending on it would loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, jobId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    const agorot = shekelsToAgorot(amount);
    if (!description.trim() || agorot <= 0) return;
    setSaving(true);
    const { error } = await supabase
      .from("job_expenses")
      .insert({ job_id: jobId, description: description.trim(), amount_agorot: agorot });
    setSaving(false);
    if (error) return toast.error(errorMessage(error, "שגיאה בהוספת ההוצאה"));
    setDescription("");
    setAmount("");
    await load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("job_expenses").delete().eq("id", id);
    if (error) return toast.error(errorMessage(error, "שגיאה במחיקת ההוצאה"));
    await load();
  }

  if (!supported) return null;

  const total = rows.reduce((sum, r) => sum + r.amount_agorot, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-ink-400" /> הוצאות על העבודה הזו
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-ink-500">
          חלקים, השכרת ציוד, חניה — כל מה ששילמתם בשביל העבודה הזו. זה יורד מהרווח שלה, ומתעדכן
          לבד בסיכומים ובמאזן.
        </p>

        {rows.length > 0 && (
          <div className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100">
            {rows.map((row) => (
              <div key={row.id} className="flex items-center gap-2 px-3.5 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-800">
                  {row.description}
                </span>
                <span className="shrink-0 text-sm font-bold text-danger-600">
                  -{formatAgorot(row.amount_agorot)}
                </span>
                <button
                  type="button"
                  onClick={() => remove(row.id)}
                  className="shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-danger-600"
                  aria-label={`מחיקת ${row.description}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <div className="flex items-center justify-between bg-ink-50 px-3.5 py-2.5">
              <span className="text-sm font-extrabold text-ink-900">סה״כ הוצאות</span>
              <span className="text-sm font-extrabold text-danger-600">-{formatAgorot(total)}</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="על מה? למשל: משאבה"
            className="min-w-[10rem] flex-1"
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <Input
            type="number"
            min={0}
            step={10}
            inputMode="decimal"
            dir="ltr"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="₪"
            className="w-28"
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <Button onClick={add} loading={saving} disabled={!description.trim() || shekelsToAgorot(amount) <= 0}>
            <Plus className="h-4 w-4" /> הוספה
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
