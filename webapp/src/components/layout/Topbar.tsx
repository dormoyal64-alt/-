"use client";

import Link from "next/link";
import { Bell, Briefcase } from "lucide-react";
import { useNotifications } from "@/lib/notifications";

export function Topbar() {
  const { unreadCount } = useNotifications();

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-100 bg-white/90 px-4 py-3 backdrop-blur lg:px-8 lg:py-4">
      <div className="flex items-center gap-2 lg:hidden">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Briefcase className="h-4 w-4" />
        </div>
        <span className="text-sm font-extrabold text-ink-900">JobCRM</span>
      </div>
      <div className="hidden lg:block" />
      <Link
        href="/notifications"
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink-500 hover:bg-ink-100 hover:text-ink-800"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Link>
    </header>
  );
}
