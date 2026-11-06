"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Droplets, Plus, ChevronLeft, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Label } from "@/components/ui/Input";
import { todayLocalDate } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { plainDate } from "@/lib/quotes";
import { createSurvey, findingCount, listSurveys, spotsLabel } from "@/lib/api/leaks";
import type { LeakSurveyWithPhotos } from "@/lib/types";

/**
 * איתור נזילות — what was checked, and what was found.
 *
 * A survey is started with the three things known before anyone opens a
 * cupboard: who, where, and when. Everything else — the photographs, where
 * the water is, what to do about it — is added on the survey's own page,
 * because it is added while standing in the house.
 */
export default function LeaksPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const toast = useToast();

  const [surveys, setSurveys] = useState<LeakSurveyWithPhotos[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [day, setDay] = useState(todayLocalDate());

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await listSurveys(supabase);
    setAvailable(rows !== null);
    setSurveys(rows ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function start() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const row = await createSurvey(supabase, {
        customer_name: name.trim(),
        customer_phone: phone.trim() || null,
        customer_address: address.trim() || null,
        surveyed_on: day,
      });
      router.push(`/leaks/${row.id}`);
    } catch (e) {
      toast.error(errorMessage(e, "לא הצלחנו לפתוח סקר"));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold text-ink-900">
            <Droplets className="h-6 w-6 text-brand-600" /> איתור נזילות
          </h1>
          <p className="text-sm text-ink-500">
            תמונות מהבית של הלקוח, חץ אדום בדיוק על הנזילה, ודוח מסודר שנשלח אליו בוואטסאפ. גם
            בדיקה שלא נמצא בה כלום היא דוח — היא מוכיחה מה נבדק.
          </p>
        </div>
        <Button
          onClick={() => {
            setName("");
            setPhone("");
            setAddress("");
            setDay(todayLocalDate());
            setOpening(true);
          }}
        >
          <Plus className="h-4 w-4" /> בדיקה חדשה
        </Button>
      </div>

      {!available && !loading && (
        <Card className="border-warning-200">
          <CardBody>
            <p className="text-sm font-bold text-ink-900">המסך מוכן, אבל מסד הנתונים עוד לא</p>
            <p className="mt-1 text-sm text-ink-500">
              צריך להריץ את סקריפט העדכון האחרון ב-Supabase, ואז לרענן את הדף.
            </p>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>בדיקות אחרונות</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <p className="p-4 text-sm text-ink-400">טוען...</p>
          ) : surveys.length === 0 ? (
            <p className="p-4 text-sm text-ink-400">
              עדיין לא נרשמה בדיקה. כפתור ״בדיקה חדשה״ למעלה.
            </p>
          ) : (
            <div className="divide-y divide-ink-50">
              {surveys.map((s) => {
                const spots = findingCount(s);
                const photos = s.leak_survey_photos?.length ?? 0;
                return (
                  <Link
                    key={s.id}
                    href={`/leaks/${s.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-ink-50"
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                        s.found === true
                          ? "bg-danger-50 text-danger-600"
                          : s.found === false
                            ? "bg-success-50 text-success-600"
                            : "bg-ink-100 text-ink-400"
                      }`}
                    >
                      {s.found === true ? (
                        <AlertTriangle className="h-4 w-4" />
                      ) : s.found === false ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <Clock className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-ink-900">
                        {s.customer_name}
                        <span className="mr-1.5 text-xs font-normal text-ink-400">
                          {s.survey_number}
                        </span>
                      </p>
                      <p className="truncate text-xs text-ink-500">
                        {plainDate(s.surveyed_on)}
                        {s.customer_address ? ` · ${s.customer_address}` : ""}
                        {" · "}
                        {s.found === true
                          ? spotsLabel(spots)
                          : s.found === false
                            ? "ללא ממצאים"
                            : "טרם הושלמה"}
                        {photos > 0 ? ` · ${photos} תמונות` : ""}
                        {s.sent_at ? " · נשלח" : ""}
                      </p>
                    </div>
                    <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
                  </Link>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <Modal open={opening} onClose={() => setOpening(false)} title="בדיקת נזילות חדשה" size="sm">
        <div className="space-y-3">
          <div>
            <Label required>שם הלקוח</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: משה כהן" />
          </div>
          <div>
            <Label>טלפון</Label>
            <Input
              type="tel"
              inputMode="tel"
              dir="ltr"
              className="text-right"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="050-0000000"
            />
            <p className="mt-1 text-xs text-ink-400">לשם הזה יישלח הדוח בסוף.</p>
          </div>
          <div>
            <Label>כתובת הנכס</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="רחוב, מספר, עיר"
            />
          </div>
          <div>
            <Label required>תאריך הבדיקה</Label>
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setOpening(false)}>
              ביטול
            </Button>
            <Button fullWidth loading={busy} disabled={!name.trim()} onClick={start}>
              המשך להעלאת תמונות
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
