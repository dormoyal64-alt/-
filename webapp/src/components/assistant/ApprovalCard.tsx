"use client";

import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { PendingAction } from "./api";

/**
 * The moment the assistant asks permission.
 *
 * Everything else on the screen is conversation; this is the only place a
 * decision is made, and it is a decision about the business's money — closing a
 * job, changing a price, paying a contractor. So it does not look like a chat
 * bubble: it is walled off in amber, it says in words what is about to happen,
 * and it names the two ways out plainly.
 *
 * The summary is the server's sentence, not ours. It knows what the tool would
 * do with which row; the screen only has to make sure it cannot be missed. The
 * tool's own name is shown underneath in small print, because the owner who
 * wants to know exactly which door is being opened should be able to see it.
 *
 * While this card is on screen the composer is disabled by the page — there is
 * nothing to say until this is answered.
 */
export function ApprovalCard({
  action,
  deciding,
  onDecide,
}: {
  action: PendingAction;
  /** which button was pressed, while the answer is in flight */
  deciding: "approve" | "reject" | null;
  onDecide: (approve: boolean) => void;
}) {
  return (
    <div className="animate-scale-in rounded-2xl border-2 border-warning-500 bg-warning-50 p-4 shadow-popover">
      <div className="flex items-start gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning-500 text-white">
          <ShieldAlert className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-warning-600">העוזר מבקש אישור</p>
          <p className="mt-1.5 break-words text-[15px] font-bold leading-6 text-ink-900">{action.summary}</p>
          <p className="mt-2 text-xs font-semibold text-ink-500">
            זו פעולה שמשנה נתונים בעסק — כלום לא יקרה עד שתאשרו, ואי אפשר לשלוח הודעה נוספת עד אז.
          </p>
          <p className="mt-1 break-all text-[11px] font-medium text-ink-400" dir="ltr">
            {action.tool_name}
          </p>
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-2">
        <Button
          variant="success"
          onClick={() => onDecide(true)}
          loading={deciding === "approve"}
          disabled={deciding !== null}
        >
          אישור
        </Button>
        <Button
          variant="secondary"
          onClick={() => onDecide(false)}
          loading={deciding === "reject"}
          disabled={deciding !== null}
        >
          ביטול
        </Button>
      </div>
    </div>
  );
}
