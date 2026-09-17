"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useRefData } from "@/lib/refdata";
import { useToast } from "@/components/ui/Toast";
import { Input, Label } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { createHelper } from "@/lib/api/helpers";
import { errorMessage } from "@/lib/errors";
import { shekelsToAgorot } from "@/lib/money";
import type { Helper } from "@/lib/types";

/**
 * "Did you take a worker?" — and a way to say yes.
 *
 * The worker list starts out empty, and until this form could add one the
 * question had exactly one possible answer: no. Adding here saves the worker
 * for next time too, so the name only ever gets typed once.
 */
export function HelperSelect({
  value,
  onChange,
}: {
  value: string;
  /** the freshly created worker is handed over, since ref data has not re-rendered yet */
  onChange: (id: string, created?: Helper) => void;
}) {
  const { helpers, isOwner, refresh } = useRefData();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pay, setPay] = useState("");
  const [saving, setSaving] = useState(false);

  const active = helpers.filter((h) => h.active);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const helper = await createHelper(trimmed, pay.trim() === "" ? null : shekelsToAgorot(pay));
      await refresh();
      onChange(helper.id, helper);
      setOpen(false);
      setName("");
      setPay("");
      toast.success(`${helper.name} נשמר ברשימת העובדים`);
    } catch (e) {
      toast.error(errorMessage(e, "שגיאה בהוספת העובד"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Label>לקחתם עובד?</Label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input">
        <option value="">לא, עבדתי לבד</option>
        {active.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name}
          </option>
        ))}
      </select>

      {isOwner && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1.5 flex items-center gap-1 text-xs font-bold text-brand-700 hover:underline"
        >
          <Plus className="h-3.5 w-3.5" />
          {active.length === 0 ? "עוד אין עובדים במערכת — הוסיפו עובד" : "הוספת עובד חדש"}
        </button>
      )}

      {isOwner && open && (
        <div className="mt-2 space-y-2 rounded-xl border border-brand-200 bg-brand-50/60 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-brand-800">עובד חדש</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1 text-ink-400 hover:bg-white hover:text-ink-700"
              aria-label="ביטול"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="שם העובד"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Input
            type="number"
            min={0}
            step={10}
            inputMode="decimal"
            dir="ltr"
            value={pay}
            onChange={(e) => setPay(e.target.value)}
            placeholder="כמה הוא מקבל בדרך כלל לעבודה (₪)"
          />
          <Button type="button" size="sm" onClick={add} loading={saving} disabled={!name.trim()}>
            <Plus className="h-4 w-4" /> שמירה ובחירה
          </Button>
          <p className="text-[11px] text-ink-500">
            הסכום הוא ברירת מחדל בלבד — אפשר לשנות אותו בכל עבודה. העובד יישמר לעבודות הבאות.
          </p>
        </div>
      )}
    </div>
  );
}
