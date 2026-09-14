"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone, Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Input } from "@/components/ui/Input";
import { agorotToShekels, formatAgorot, shekelsToAgorot } from "@/lib/money";

/**
 * Asks what advertising cost on one day, and keeps the answer in ad_spend.
 *
 * The day may already hold several rows, one per channel, entered on the
 * advertising page. This edits the day's total by moving only the row with no
 * channel on it, so the per-channel figures typed elsewhere are never
 * overwritten or quietly merged away.
 */
export function DailyAdSpend({
  day,
  compact,
  onSaved,
}: {
  /** yyyy-mm-dd */
  day: string;
  /** dashboard prompt rather than the fuller report card */
  compact?: boolean;
  onSaved?: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [total, setTotal] = useState<number | null>(null);
  const [attributed, setAttributed] = useState(0);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("ad_spend")
      .select("id, amount_agorot, lead_source_id")
      .eq("spent_on", day);
    const rows = (data as { amount_agorot: number; lead_source_id: string | null }[] | null) ?? [];
    const sum = rows.reduce((s, r) => s + r.amount_agorot, 0);
    setTotal(rows.length ? sum : null);
    setAttributed(rows.filter((r) => r.lead_source_id).reduce((s, r) => s + r.amount_agorot, 0));
    setDraft(rows.length ? String(agorotToShekels(sum)) : "");
    setLoading(false);
  }, [supabase, day]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveAmount(value: string) {
    const shekels = parseFloat(value);
    if (value.trim() === "" || Number.isNaN(shekels) || shekels < 0) {
      toast.error("נא להקליד סכום");
      return;
    }
    const wanted = shekelsToAgorot(value);
    if (wanted < attributed) {
      toast.error(
        `כבר רשומות הוצאות מפורטות של ${formatAgorot(attributed)} ליום הזה — הסכום לא יכול להיות נמוך מזה.`
      );
      return;
    }
    setSaving(true);
    const { data: loose } = await supabase
      .from("ad_spend")
      .select("id")
      .eq("spent_on", day)
      .is("lead_source_id", null)
      .limit(1);
    const rest = wanted - attributed;
    const looseId = (loose as { id: string }[] | null)?.[0]?.id;

    const { error } = looseId
      ? rest === 0
        ? await supabase.from("ad_spend").delete().eq("id", looseId)
        : await supabase.from("ad_spend").update({ amount_agorot: rest }).eq("id", looseId)
      : rest === 0
        ? await supabase.from("ad_spend").insert({ spent_on: day, amount_agorot: 0, lead_source_id: null })
        : await supabase.from("ad_spend").insert({ spent_on: day, amount_agorot: rest, lead_source_id: null });

    setSaving(false);
    if (error) return toast.error("שגיאה בשמירת ההוצאה");
    toast.success(`נרשמו ${formatAgorot(wanted)} פרסום ל-${day}`);
    await load();
    onSaved?.();
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-ink-100 bg-white px-4 py-3.5 text-sm text-ink-400">
        <Loader2 className="h-4 w-4 animate-spin" /> טוען הוצאות פרסום...
      </div>
    );
  }

  const answered = total != null;

  return (
    <div
      className={`rounded-2xl border px-4 py-3.5 ${
        answered ? "border-ink-100 bg-white" : "border-brand-200 bg-brand-50/60"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <Megaphone className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${answered ? "text-ink-400" : "text-brand-600"}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink-900">
            {answered ? `הוצאות פרסום · ${day}` : "כמה הוצאתם היום על פרסום?"}
          </p>
          {!answered ? (
            <p className="mt-0.5 text-xs text-ink-500">
              בלי זה הרווח שמוצג הוא לפני פרסום — כלומר גבוה מהאמת.
            </p>
          ) : (
            attributed > 0 && (
              <p className="mt-0.5 text-xs text-ink-400">
                מתוכם {formatAgorot(attributed)} משויכים לערוצים במסך ״הוצאות פרסום״
              </p>
            )
          )}

          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="w-32">
              <Input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveAmount(draft);
                }}
                placeholder="₪"
                dir="ltr"
              />
            </div>
            <button
              type="button"
              onClick={() => saveAmount(draft)}
              disabled={saving}
              className="btn-primary flex items-center gap-1.5 px-3.5 py-2.5 text-sm disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              שמירה
            </button>
            {!answered && !compact && (
              <button
                type="button"
                onClick={() => saveAmount("0")}
                disabled={saving}
                className="px-2 py-2.5 text-sm font-semibold text-ink-400 hover:text-ink-700"
              >
                לא פרסמתי היום
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
