"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import clsx from "clsx";

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 animate-fade-in bg-ink-950/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className={clsx(
          "animate-slide-up relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-popover sm:mx-4 sm:max-h-[85vh] sm:rounded-2xl",
          size === "sm" && "sm:max-w-sm",
          size === "md" && "sm:max-w-lg",
          size === "lg" && "sm:max-w-2xl"
        )}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
            <h3 className="text-lg font-bold text-ink-900">{title}</h3>
            <button onClick={onClose} className="rounded-full p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-ink-100 px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
