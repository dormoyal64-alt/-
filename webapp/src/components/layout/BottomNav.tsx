"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import { LayoutDashboard, Briefcase, PlusCircle, Users, Menu } from "lucide-react";
import { MoreSheet } from "./MoreSheet";

const items = [
  { href: "/dashboard", label: "בית", icon: LayoutDashboard },
  { href: "/jobs", label: "עבודות", icon: Briefcase },
  { href: "/jobs/new", label: "הוספה", icon: PlusCircle, primary: true },
  { href: "/contractors", label: "קבלנים", icon: Users },
];

export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5 items-center px-1">
          {items.map((item) => {
            const active = pathname === item.href || (item.href !== "/dashboard" && item.href !== "/jobs/new" && pathname.startsWith(item.href));
            if (item.primary) {
              return (
                <Link key={item.href} href={item.href} className="flex flex-col items-center gap-1 py-2">
                  <span className="-mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/30 active:scale-95">
                    <item.icon className="h-7 w-7" />
                  </span>
                  <span className="text-[11px] font-bold text-brand-700">{item.label}</span>
                </Link>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "flex flex-col items-center gap-1 py-3 text-[11px] font-semibold",
                  active ? "text-brand-600" : "text-ink-400"
                )}
              >
                <item.icon className="h-6 w-6" />
                {item.label}
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen(true)}
            className="flex flex-col items-center gap-1 py-3 text-[11px] font-semibold text-ink-400"
          >
            <Menu className="h-6 w-6" />
            עוד
          </button>
        </div>
      </nav>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
