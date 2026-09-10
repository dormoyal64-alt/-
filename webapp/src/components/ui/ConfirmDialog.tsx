"use client";

import { Modal } from "./Modal";
import { Button } from "./Button";
import { AlertTriangle } from "lucide-react";

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "אישור",
  danger = true,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} size="sm">
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <div className={`flex h-12 w-12 items-center justify-center rounded-full ${danger ? "bg-danger-50 text-danger-500" : "bg-brand-50 text-brand-600"}`}>
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h3 className="text-lg font-bold text-ink-900">{title}</h3>
        {description && <p className="text-sm text-ink-500">{description}</p>}
      </div>
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" fullWidth onClick={onClose}>
          ביטול
        </Button>
        <Button variant={danger ? "danger" : "primary"} fullWidth onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
