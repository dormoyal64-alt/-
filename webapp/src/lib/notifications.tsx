"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatAppointmentHe } from "@/lib/dates";
import type { AppNotification } from "@/lib/types";

const DEFAULT_REMINDER_MINUTES = 120;
const DEFAULT_APPOINTMENT_LEAD_MINUTES = 15;
// how far back a missed appointment may be and still be worth a heads-up;
// past that the stale-job reminder is the one that should speak
const APPOINTMENT_GRACE_MS = 60 * 60 * 1000;
const POLL_INTERVAL_MS = 60_000;

function minutesLabel(mins: number): string {
  if (mins < 60) return `${mins} דקות`;
  const hours = mins / 60;
  return Number.isInteger(hours) ? `${hours} שעות` : `${hours.toFixed(1)} שעות`;
}

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
    // the owner sets how long a job may sit before it needs a status check
    const { data: settings } = await supabase
      .from("app_settings")
      .select("reminder_minutes")
      .eq("id", true)
      .maybeSingle();
    const reminderMinutes: number = settings?.reminder_minutes ?? DEFAULT_REMINDER_MINUTES;
    const threshold = new Date(Date.now() - reminderMinutes * 60 * 1000).toISOString();
    // Claim the jobs before announcing them. Marking and then inserting would
    // let two runs — two tabs, two people, or a remount — both read the same
    // unmarked rows and both insert, which is how every alert came out twice.
    // An update that requires the mark to still be null can only win once per
    // row, and hands back exactly the rows this run took.
    // A job booked for Thursday is not sitting idle on Monday. It becomes worth
    // chasing the same interval after the hour the customer asked for — so two
    // claims, one for the unbooked and one for the booked-and-overdue. They are
    // two passes rather than one `or`, because PostgREST refuses a logical
    // operator on an update and quietly matches nothing.
    const claim = (mark: (q: any) => any) =>
      mark(
        supabase
          .from("jobs")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("is_closed", false)
          .is("reminder_sent_at", null)
          .lt("opened_at", threshold)
      ).select("id, job_number, customer_name");

    const [unbooked, overdue] = await Promise.all([
      claim((q) => q.is("scheduled_at", null)),
      claim((q) => q.lt("scheduled_at", threshold)),
    ]);
    const staleJobs = [...(unbooked.data ?? []), ...(overdue.data ?? [])];

    if (!staleJobs || staleJobs.length === 0) return;

    const rows = staleJobs.map((j) => ({
      job_id: j.id,
      type: "stale_job",
      message: `עברו ${minutesLabel(reminderMinutes)} מאז פתיחת העבודה ${j.job_number} (${j.customer_name}) והיא עדיין לא נסגרה — יש לבדוק סטטוס.`,
    }));

    await supabase.from("notifications").insert(rows);

    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      staleJobs.forEach((j) => {
        new Notification("תזכורת עבודה", {
          body: `עברו ${minutesLabel(reminderMinutes)} מאז פתיחת עבודה ${j.job_number} (${j.customer_name})`,
          tag: `stale-${j.id}`,
        });
      });
    }

    refresh();
  }, [supabase, refresh]);

  // A booked job is not late, so the stale-job nag never speaks for it. This
  // one does, shortly before the hour the customer asked for.
  const checkUpcomingAppointments = useCallback(async () => {
    const { data: settings } = await supabase
      .from("app_settings")
      .select("appointment_lead_minutes")
      .eq("id", true)
      .maybeSingle();
    const lead: number = settings?.appointment_lead_minutes ?? DEFAULT_APPOINTMENT_LEAD_MINUTES;
    if (lead <= 0) return;

    const now = Date.now();
    // claimed by the update itself, so two runs cannot both announce the same job
    const { data: soon } = await supabase
      .from("jobs")
      .update({ scheduled_reminder_sent_at: new Date().toISOString() })
      .eq("is_closed", false)
      .not("scheduled_at", "is", null)
      .is("scheduled_reminder_sent_at", null)
      .lte("scheduled_at", new Date(now + lead * 60_000).toISOString())
      // an appointment missed days ago must not produce a pile of alerts the
      // first time the app is opened again
      .gte("scheduled_at", new Date(now - APPOINTMENT_GRACE_MS).toISOString())
      .select("id, job_number, customer_name, address_full, scheduled_at, contractor:contractors(name)");

    if (!soon || soon.length === 0) return;

    const rows = soon.map((j: any) => ({
      job_id: j.id,
      type: "upcoming_appointment",
      message:
        `עבודה ${j.job_number} (${j.customer_name}) מתוזמנת ל${formatAppointmentHe(j.scheduled_at)}` +
        (j.contractor?.name ? ` — ${j.contractor.name}` : "") +
        (j.address_full ? `, ${j.address_full}` : "") +
        ". כדאי לוודא שהקבלן בדרך.",
    }));

    await supabase.from("notifications").insert(rows);

    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      soon.forEach((j: any) => {
        new Notification("עבודה מתוזמנת מתקרבת", {
          body: `${j.job_number} (${j.customer_name}) — ${formatAppointmentHe(j.scheduled_at)}`,
          tag: `appointment-${j.id}`,
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
    checkUpcomingAppointments();
    const interval = setInterval(() => {
      checkStaleJobs();
      checkUpcomingAppointments();
    }, POLL_INTERVAL_MS);
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
