"use client";

import Link from "next/link";
import { Bell, BellRing, CheckCheck, AlertTriangle } from "lucide-react";
import { useNotifications } from "@/lib/notifications";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Misc";
import { relativeTimeHe } from "@/lib/dates";

export default function NotificationsPage() {
  const { notifications, unreadCount, markRead, markAllRead, notificationPermission, requestPermission } = useNotifications();

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-ink-900">התראות</h1>
          <p className="text-sm text-ink-500">{unreadCount > 0 ? `${unreadCount} התראות שלא נקראו` : "הכל עדכני"}</p>
        </div>
        {unreadCount > 0 && (
          <Button variant="secondary" size="sm" onClick={markAllRead}>
            <CheckCheck className="h-4 w-4" /> סמן הכל כנקרא
          </Button>
        )}
      </div>

      {notificationPermission !== "granted" && notificationPermission !== "unsupported" && (
        <Card className="border-2 border-brand-100 bg-brand-50/50">
          <CardBody className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <BellRing className="h-5 w-5 shrink-0 text-brand-600" />
              <p className="text-sm text-ink-700">הפעילו התראות דפדפן כדי לקבל עדכון גם כשהמסך הזה סגור.</p>
            </div>
            <Button size="sm" onClick={requestPermission} className="shrink-0">
              הפעלה
            </Button>
          </CardBody>
        </Card>
      )}

      {notifications.length === 0 ? (
        <EmptyState icon={Bell} title="אין התראות עדיין" description="כשעבודה תישאר פתוחה יותר משעתיים, תופיע כאן התראה." />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => !n.is_read && markRead(n.id)}
              className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-right transition ${
                n.is_read ? "border-ink-100 bg-white" : "border-warning-200 bg-warning-50/60"
              }`}
            >
              <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${n.is_read ? "bg-ink-100 text-ink-400" : "bg-warning-100 text-warning-600"}`}>
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${n.is_read ? "text-ink-500" : "font-semibold text-ink-800"}`}>{n.message}</p>
                <p className="mt-1 text-xs text-ink-400">{relativeTimeHe(n.created_at)}</p>
                {n.job_id && (
                  <Link href={`/jobs/${n.job_id}`} className="mt-1.5 inline-block text-xs font-bold text-brand-600">
                    צפייה בעבודה ←
                  </Link>
                )}
              </div>
              {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warning-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
