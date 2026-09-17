"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronRight, ChevronLeft, MapPin, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { PageSpinner } from "@/components/ui/Misc";
import { JOB_SELECT } from "@/lib/api/jobs";
import { formatAgorot } from "@/lib/money";
import { formatTimeHe } from "@/lib/dates";
import type { JobWithRelations } from "@/lib/types";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** The Sunday on or before this date, at midnight local time. */
function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export default function SchedulePage() {
  const supabase = useMemo(() => createClient(), []);
  const [start, setStart] = useState(() => weekStart(new Date()));
  const [jobs, setJobs] = useState<JobWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const end = useMemo(() => new Date(start.getTime() + 7 * DAY_MS), [start]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("jobs")
      .select(JOB_SELECT)
      .not("scheduled_at", "is", null)
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString())
      .order("scheduled_at", { ascending: true });
    setJobs((data as unknown as JobWithRelations[]) ?? []);
    setLoading(false);
  }, [supabase, start, end]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  // someone else may have booked a job since this loaded
  useAutoRefresh(() => setReloadKey((k) => k + 1));

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS)),
    [start]
  );
  const byDay = useMemo(() => {
    const map = new Map<number, JobWithRelations[]>();
    days.forEach((d) => map.set(d.getTime(), []));
    jobs.forEach((j) => {
      const when = new Date(j.scheduled_at!);
      const key = new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime();
      map.get(key)?.push(j);
    });
    return map;
  }, [jobs, days]);

  const today = new Date();
  const thisWeek = sameDay(start, weekStart(today));
  // A day gone by with nothing in it is four screens of scrolling between you
  // and today, so it drops out. A past day that held work stays, because that
  // is a record of the week.
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const shownDays = days.filter(
    (d) => d.getTime() >= startOfToday || (byDay.get(d.getTime()) ?? []).length > 0
  );
  const hiddenDays = days.length - shownDays.length;
  const rangeLabel = `${days[0].getDate()}.${days[0].getMonth() + 1} — ${days[6].getDate()}.${days[6].getMonth() + 1}.${days[6].getFullYear()}`;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold text-ink-900">
            <CalendarClock className="h-6 w-6 text-ink-400" /> לוח זמנים
          </h1>
          <p className="text-sm text-ink-500">
            {rangeLabel} · {jobs.length} עבודות מתוזמנות
            {hiddenDays > 0 && ` · ${hiddenDays} ימים שחלפו ללא עבודות אינם מוצגים`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setStart(new Date(start.getTime() - 7 * DAY_MS))}>
            <ChevronRight className="h-4 w-4" /> שבוע קודם
          </Button>
          {!thisWeek && (
            <Button variant="secondary" size="sm" onClick={() => setStart(weekStart(new Date()))}>
              השבוע
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setStart(new Date(start.getTime() + 7 * DAY_MS))}>
            שבוע הבא <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <PageSpinner />
      ) : shownDays.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center">
            <CalendarClock className="mx-auto mb-2 h-8 w-8 text-ink-300" />
            <p className="text-sm font-semibold text-ink-500">אין עבודות מתוזמנות בשבוע הזה</p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {shownDays.map((d) => {
            const list = byDay.get(d.getTime()) ?? [];
            const isToday = sameDay(d, today);
            return (
              <Card
                key={d.getTime()}
                className={isToday ? "border-2 border-brand-200 bg-brand-50/30" : undefined}
              >
                <CardBody className="space-y-2.5">
                  <div className="flex items-baseline justify-between border-b border-ink-100 pb-2">
                    <span className={`font-extrabold ${isToday ? "text-brand-700" : "text-ink-800"}`}>
                      {isToday ? "היום" : `יום ${WEEKDAYS[d.getDay()]}`}
                    </span>
                    <span className="text-xs font-semibold text-ink-400">
                      {d.getDate()}.{d.getMonth() + 1}
                    </span>
                  </div>

                  {list.length === 0 ? (
                    <p className="py-2 text-center text-xs text-ink-300">אין עבודות מתוזמנות</p>
                  ) : (
                    list.map((job) => (
                      <Link
                        key={job.id}
                        href={`/jobs/${job.id}`}
                        className={`block rounded-xl border p-2.5 transition hover:bg-ink-50 ${
                          job.is_closed
                            ? "border-ink-100 bg-ink-50/60 opacity-70"
                            : new Date(job.scheduled_at!).getTime() < Date.now()
                              ? "border-warning-200 bg-warning-50/60"
                              : "border-ink-100"
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-base font-extrabold text-ink-900" dir="ltr">
                            {formatTimeHe(job.scheduled_at!)}
                          </span>
                          {job.status && <StatusBadge name={job.status.name} color={job.status.color} />}
                        </div>
                        <p className="mt-0.5 truncate text-sm font-bold text-ink-800">{job.customer_name}</p>
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-500">
                          <MapPin className="h-3 w-3 shrink-0" />
                          {job.address_full || job.city?.name || "—"}
                        </p>
                        <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                          <span className="flex items-center gap-1 truncate text-ink-500">
                            <User className="h-3 w-3 shrink-0" />
                            {job.contractor?.name ?? "לא שויך"}
                          </span>
                          <span className="shrink-0 font-bold text-ink-700">
                            {formatAgorot(job.is_closed ? job.final_price_agorot : job.quoted_price_agorot)}
                          </span>
                        </div>
                      </Link>
                    ))
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
