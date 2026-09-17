"use client";

import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { mainNav, reportsNav, settingsNav, utilityNav } from "./nav";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useRouter } from "next/navigation";

export function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { isOwner } = useRefData();
  const reports = reportsNav.filter((i) => isOwner || !i.ownerOnly);
  const rest = [...settingsNav, ...utilityNav].filter((i) => isOwner || !i.ownerOnly);
  // the bar at the bottom of the screen only holds four, so whatever is left
  // over from the main navigation has to be reachable from here
  const BOTTOM_BAR = ["/dashboard", "/jobs", "/jobs/new", "/contractors"];
  const extras = mainNav.filter((i) => !BOTTOM_BAR.includes(i.href) && (isOwner || !i.ownerOnly));

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <Modal open={open} onClose={onClose} title="עוד">
      <div className="space-y-5">
        {extras.length > 0 && (
          <div>
            <div className="grid grid-cols-2 gap-2">
              {extras.map((item) => (
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
        )}
        {reports.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-400">דוחות וניהול כספי</p>
          <div className="grid grid-cols-2 gap-2">
            {reports.map((item) => (
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
        )}
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-400">הגדרות</p>
          <div className="grid grid-cols-2 gap-2">
            {rest.map((item) => (
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
