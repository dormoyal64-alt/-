"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Briefcase, LogOut } from "lucide-react";
import { sidebarSections } from "./nav";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-l border-ink-100 bg-white lg:flex">
      <div className="flex items-center gap-2.5 px-6 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
          <Briefcase className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-extrabold text-ink-900">JobCRM</p>
          <p className="text-xs text-ink-400">ניהול עבודות וקבלנים</p>
        </div>
      </div>

      <nav className="no-scrollbar flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {sidebarSections.map((section, i) => (
          <div key={i}>
            {section.title && (
              <p className="mb-1.5 px-3 text-xs font-bold uppercase tracking-wide text-ink-400">{section.title}</p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={clsx(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                      active ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
                    )}
                  >
                    <item.icon className={clsx("h-[18px] w-[18px]", active ? "text-brand-600" : "text-ink-400")} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <button
        onClick={signOut}
        className="mx-3 mb-4 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink-500 hover:bg-danger-50 hover:text-danger-600"
      >
        <LogOut className="h-[18px] w-[18px]" />
        התנתקות
      </button>
    </aside>
  );
}
