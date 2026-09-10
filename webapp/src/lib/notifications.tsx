"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AppNotification } from "@/lib/types";

const STALE_JOB_HOURS = 2;
const POLL_INTERVAL_MS = 60_000;

interface NotificationsContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  notificationPermission: NotificationPermission | "unsupported";
  requestPermission: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setNotifications(data ?? []);
    setLoading(false);
  }, [supabase]);

  const checkStaleJobs = useCallback(async () => {
    const threshold = new Date(Date.now() - STALE_JOB_HOURS * 60 * 60 * 1000).toISOString();
    const { data: staleJobs } = await supabase
      .from("jobs")
      .select("id, job_number, customer_name")
      .eq("is_closed", false)
      .is("reminder_sent_at", null)
      .lt("opened_at", threshold);

    if (!staleJobs || staleJobs.length === 0) return;

    const rows = staleJobs.map((j) => ({
      job_id: j.id,
      type: "stale_job",
      message: `עברו ${STALE_JOB_HOURS} שעות מאז פתיחת העבודה ${j.job_number} (${j.customer_name}) והיא עדיין לא נסגרה — יש לבדוק סטטוס.`,
    }));

    await supabase.from("notifications").insert(rows);
    await supabase
      .from("jobs")
      .update({ reminder_sent_at: new Date().toISOString() })
      .in(
        "id",
        staleJobs.map((j) => j.id)
      );

    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      staleJobs.forEach((j) => {
        new Notification("תזכורת עבודה", {
          body: `עברו ${STALE_JOB_HOURS} שעות מאז פתיחת עבודה ${j.job_number} (${j.customer_name})`,
          tag: `stale-${j.id}`,
        });
      });
    }

    refresh();
  }, [supabase, refresh]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission);
    } else {
      setPermission("unsupported");
    }
    refresh();
    checkStaleJobs();
    const interval = setInterval(checkStaleJobs, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markRead = useCallback(
    async (id: string) => {
      await supabase.from("notifications").update({ is_read: true }).eq("id", id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    },
    [supabase]
  );

  const markAllRead = useCallback(async () => {
    await supabase.from("notifications").update({ is_read: true }).eq("is_read", false);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }, [supabase]);

  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        refresh,
        markRead,
        markAllRead,
        notificationPermission: permission,
        requestPermission,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
