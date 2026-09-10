"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import clsx from "clsx";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let idCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, kind: ToastKind = "info") => {
    const id = ++idCounter;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const value: ToastContextValue = {
    show,
    success: (m) => show(m, "success"),
    error: (m) => show(m, "error"),
    info: (m) => show(m, "info"),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed inset-x-0 bottom-24 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "animate-slide-up flex w-full max-w-sm items-start gap-2.5 rounded-2xl border px-4 py-3 shadow-popover backdrop-blur",
              t.kind === "success" && "border-success-100 bg-success-50/95 text-success-700",
              t.kind === "error" && "border-danger-100 bg-danger-50/95 text-danger-600",
              t.kind === "info" && "border-brand-100 bg-white/95 text-ink-800"
            )}
          >
            {t.kind === "success" && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />}
            {t.kind === "error" && <XCircle className="mt-0.5 h-5 w-5 shrink-0" />}
            {t.kind === "info" && <Info className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />}
            <p className="text-sm font-medium leading-5">{t.message}</p>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="mr-auto shrink-0 text-ink-400 hover:text-ink-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
