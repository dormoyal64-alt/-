"use client";

import { Modal } from "@/components/ui/Modal";
import { useRefData } from "@/lib/refdata";
import { StatusBadge } from "@/components/ui/Badge";

export function StatusMenu({
  open,
  onClose,
  currentStatusId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  currentStatusId: string;
  onSelect: (statusId: string) => void;
}) {
  const { jobStatuses } = useRefData();
  return (
    <Modal open={open} onClose={onClose} title="שינוי סטטוס">
      <div className="space-y-1.5">
        {jobStatuses
          .filter((s) => s.is_active)
          .map((s) => (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              disabled={s.id === currentStatusId}
              className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-sm transition ${
                s.id === currentStatusId ? "border-ink-100 bg-ink-50 opacity-60" : "border-ink-100 hover:bg-ink-50"
              }`}
            >
              <StatusBadge name={s.name} color={s.color} />
              {s.id === currentStatusId && <span className="text-xs text-ink-400">נוכחי</span>}
            </button>
          ))}
      </div>
    </Modal>
  );
}
