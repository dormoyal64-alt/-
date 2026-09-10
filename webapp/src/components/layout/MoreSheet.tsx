"use client";

import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { reportsNav, settingsNav, utilityNav } from "./nav";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <Modal open={open} onClose={onClose} title="עוד">
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-400">דוחות וניהול כספי</p>
          <div className="grid grid-cols-2 gap-2">
            {reportsNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className="flex flex-col items-center gap-2 rounded-2xl border border-ink-100 p-4 text-center text-sm font-semibold text-ink-700 active:scale-[.97]"
              >
                <item.icon className="h-6 w-6 text-brand-600" />
                {item.label}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-400">הגדרות</p>
          <div className="grid grid-cols-2 gap-2">
            {[...settingsNav, ...utilityNav].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className="flex flex-col items-center gap-2 rounded-2xl border border-ink-100 p-4 text-center text-sm font-semibold text-ink-700 active:scale-[.97]"
              >
                <item.icon className="h-6 w-6 text-brand-600" />
                {item.label}
              </Link>
            ))}
          </div>
        </div>
        <button
          onClick={signOut}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-danger-100 bg-danger-50 py-3 text-sm font-bold text-danger-600"
        >
          <LogOut className="h-4 w-4" />
          התנתקות
        </button>
      </div>
    </Modal>
  );
}
