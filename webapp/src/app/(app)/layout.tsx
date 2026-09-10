"use client";

import { RefDataProvider } from "@/lib/refdata";
import { NotificationsProvider } from "@/lib/notifications";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { Topbar } from "@/components/layout/Topbar";

// All routes under this layout read the logged-in user's data client-side and
// are gated by middleware auth, so there is nothing useful to prerender at
// build time — force them to render per-request instead.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RefDataProvider>
      <NotificationsProvider>
        <div className="flex min-h-screen bg-ink-50/60">
          <Sidebar />
          <div className="flex min-h-screen flex-1 flex-col">
            <Topbar />
            <main className="flex-1 px-4 pb-24 pt-4 lg:px-8 lg:pb-8 lg:pt-6">{children}</main>
          </div>
          <BottomNav />
        </div>
      </NotificationsProvider>
    </RefDataProvider>
  );
}
