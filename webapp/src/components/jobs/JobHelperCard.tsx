"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { useRefData } from "@/lib/refdata";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { HelperSelect } from "@/components/jobs/HelperSelect";
import { formatAgorot, shekelsToAgorot } from "@/lib/money";
import { errorMessage } from "@/lib/errors";
import type { Helper, JobWithRelations } from "@/lib/types";

/**
 * The worker on a job I did myself, and what they were paid for it.
 *
 * Closing the job asks for this, but a job closed before it asked — or closed
 * in a hurry, or paid later than it was closed — had no way back in: the
 * profit card only shows the line once there is a figure, so a job with no
 * wage on it offered nothing to correct.
 *
 * It sits here rather than behind the closing because the wage is not part of
 * what the closing settled. Changing it rewrites no split and touches no
 * settlement; it only says what left the business for this job, which the
 * totals then follow.
 */
export function JobHelperCard({
  job,
  onSaved,
}: {
  job: JobWithRelations;
  onSaved: () => void | Promise<void>;
}) {
  const supabase = createClient();
  const toast = useToast();
  const { helpers, isOwner } = useRefData();

  const [helperId, setHelperId] = useState(job.helper_id ?? "");
  const [pay, setPay] = useState(job.helper_pay_agorot ? String(job.helper_pay_agorot / 100) : "");
  const [saving, setSaving] = useState(false);

  // a worker of ours goes out only on a job we do ourselves, and the figure is
  // the owner's alone — the same two limits the closing keeps
  if (job.performed_by !== "self" || !isOwner) return null;

  const payAgorot = pay.trim() ? shekelsToAgorot(pay) : 0;
  const stored = job.helper_pay_agorot ?? 0;
  const changed = payAgorot !== stored || (helperId || null) !== (job.helper_id ?? null);

  /** Picking a worker offers their usual rate, unless a figure is already in. */
  function choose(id: string, created?: Helper) {
    setHelperId(id);
    if (pay.trim()) return;
    const rate = created?.default_pay_agorot ?? helpers.find((h) => h.id === id)?.default_pay_agorot;
    if (rate) setPay(String(rate / 100));
  }

  async function save() {
    if (!Number.isFinite(payAgorot) || payAgorot < 0) return toast.error("סכום לא תקין");
    setSaving(true);
    const { error } = await supabase
      .from("jobs")
      .update({ helper_id: helperId || null, helper_pay_agorot: payAgorot })
      .eq("id", job.id);
    setSaving(false);
    if (error) return toast.error(errorMessage(error, "שגיאה בשמירת השכר"));
    await onSaved();
    toast.success(payAgorot > 0 ? "השכר לעובד נשמר" : "העובד הוסר מהעבודה");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-ink-400" /> עובד בעבודה הזו
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-ink-500">
          כמה שילמתם לעובד שבא איתכם לעבודה הזו. יורד מהרווח שלה ומכל הסיכומים —{" "}
          <b>ולא נשלח לרואה החשבון</b>. אפשר לשנות גם אחרי שהעבודה נסגרה.
        </p>

        <HelperSelect value={helperId} onChange={choose} />

        {helperId && (
          <div>
            <Label htmlFor="job-helper-pay">כמה שילמתם לו על העבודה הזו? (₪)</Label>
            <Input
              id="job-helper-pay"
              type="number"
              min={0}
              step={10}
              inputMode="decimal"
              dir="ltr"
              value={pay}
              onChange={(e) => setPay(e.target.value)}
              placeholder="₪"
              onKeyDown={(e) => e.key === "Enter" && changed && save()}
            />
          </div>
        )}

        {stored > 0 && (
          <p className="text-xs text-ink-400">
            רשום כרגע: {formatAgorot(stored)}
            {job.helper ? ` ל${job.helper.name}` : ""}
          </p>
        )}

        <Button onClick={save} loading={saving} disabled={!changed} className="w-full">
          שמירה
        </Button>
      </CardBody>
    </Card>
  );
}
