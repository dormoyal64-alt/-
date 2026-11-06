"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Droplets,
  ArrowRight,
  Check,
  Loader2,
  MessageCircle,
  Share2,
  FileDown,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LeakPhotoCard, AddPhotosButton } from "@/components/leaks/LeakPhotoCard";
import { errorMessage } from "@/lib/errors";
import { buildWhatsappLink } from "@/lib/whatsapp";
import { quoteBusinessFrom } from "@/lib/quote/render";
import { plainDate } from "@/lib/quotes";
import {
  deletePhoto,
  deleteSurvey,
  fetchSurvey,
  orderedPhotos,
  photoUrl,
  spotsLabel,
  updatePhoto,
  updateSurvey,
  uploadSurveyPhoto,
} from "@/lib/api/leaks";
import {
  canShareFiles,
  deliverLeakReport,
  prepareLeakPhotos,
} from "@/lib/leak/pdf";
import type { LeakSurveyWithPhotos } from "@/lib/types";

/**
 * Writing one leak survey.
 *
 * Everything is saved as it is typed rather than behind a Save button: this is
 * filled in while standing in somebody's bathroom, a photograph at a time, and
 * a form that loses an hour's work because the phone locked is worse than no
 * form. The only deliberate action on the page is sending it.
 */
export default function LeakSurveyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const { settings } = useRefData();

  const [survey, setSurvey] = useState<LeakSurveyWithPhotos | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState<string | null>(null);
  const [chatOpened, setChatOpened] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // held locally so typing is not fought by every reload
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [surveyedOn, setSurveyedOn] = useState("");
  const [summary, setSummary] = useState("");
  const [recommendation, setRecommendation] = useState("");

  const load = useCallback(async () => {
    try {
      const row = await fetchSurvey(supabase, id);
      setSurvey(row);
      if (row) {
        setName(row.customer_name);
        setPhone(row.customer_phone ?? "");
        setAddress(row.customer_address ?? "");
        setSurveyedOn(row.surveyed_on);
        setSummary(row.summary ?? "");
        setRecommendation(row.recommendation ?? "");
        // signed links, one hour each, fetched only for photographs we do not
        // already hold one for
        const photos = orderedPhotos(row);
        const fresh: Record<string, string> = {};
        await Promise.all(
          photos.map(async (p) => {
            const u = await photoUrl(supabase, p.storage_path);
            if (u) fresh[p.id] = u;
          })
        );
        setUrls((prev) => ({ ...prev, ...fresh }));
      }
    } catch (e) {
      toast.error(errorMessage(e, "לא הצלחנו לטעון את הסקר"));
    } finally {
      setLoading(false);
    }
    // toast is stable enough in practice and listing it re-runs the load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, id]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(fields: Parameters<typeof updateSurvey>[2]) {
    if (!survey) return;
    try {
      await updateSurvey(supabase, survey.id, fields);
      setSurvey((s) => (s ? { ...s, ...fields } : s));
    } catch (e) {
      toast.error(errorMessage(e, "לא הצלחנו לשמור"));
    }
  }

  async function addPhotos(files: File[]) {
    if (!survey) return;
    setUploading(true);
    let added = 0;
    try {
      let order = orderedPhotos(survey).length;
      for (const file of files) {
        await uploadSurveyPhoto(supabase, survey.id, file, order++);
        added++;
      }
    } catch (e) {
      toast.error(errorMessage(e, "לא הצלחנו להעלות את התמונה"));
    } finally {
      setUploading(false);
      await load();
      if (added) toast.success(added === 1 ? "התמונה נוספה" : `${added} תמונות נוספו`);
    }
  }

  async function markPhoto(photoId: string, x: number | null, y: number | null) {
    setSurvey((s) =>
      s
        ? {
            ...s,
            leak_survey_photos: s.leak_survey_photos.map((p) =>
              p.id === photoId ? { ...p, marker_x: x, marker_y: y } : p
            ),
          }
        : s
    );
    try {
      await updatePhoto(supabase, photoId, { marker_x: x, marker_y: y });
    } catch (e) {
      toast.error(errorMessage(e, "לא הצלחנו לשמור את הסימון"));
      await load();
    }
  }

  async function removePhoto(photoId: string) {
    if (!survey) return;
    const photo = survey.leak_survey_photos.find((p) => p.id === photoId);
    if (!photo) return;
    setBusy(true);
    try {
      await deletePhoto(supabase, photo);
      await load();
      toast.success("התמונה נמחקה");
    } catch (e) {
      toast.error(errorMessage(e, "לא הצלחנו למחוק את התמונה"));
    } finally {
      setBusy(false);
    }
  }

  const photos = survey ? orderedPhotos(survey) : [];
  const findings = photos.filter((p) => p.marker_x != null).length;
  const biz = quoteBusinessFrom(settings, null);

  const message = survey
    ? [
        `שלום ${survey.customer_name},`,
        "",
        `מצורף דוח איתור נזילות מתאריך ${plainDate(survey.surveyed_on)}${
          survey.customer_address ? `, ${survey.customer_address}` : ""
        }.`,
        survey.found === true
          ? findings === 1
            ? "בבדיקה אותר מוקד נזילה אחד, מסומן בחץ אדום על התמונה שבדוח."
            : findings > 1
              ? `בבדיקה אותרו ${spotsLabel(findings)}, מסומנים בחץ אדום על התמונות שבדוח.`
              : "בבדיקה אותרו ממצאי נזילה. הפירוט בדוח המצורף."
          : survey.found === false
            ? "בבדיקה לא נמצאו סימני נזילה. הדוח מתעד את מה שנבדק."
            : null,
        "",
        biz.name,
        biz.number ? `ע.פ ${biz.number}` : null,
        biz.phone ? `טל׳ ${biz.phone}` : null,
      ]
        .filter((l) => l !== null)
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
    : "";

  const wa = buildWhatsappLink(survey?.customer_phone, message);
  const shareable = canShareFiles();

  async function sendReport() {
    if (!survey) return;
    if (photos.length === 0) return toast.error("צריך לפחות תמונה אחת בדוח");
    setBuilding("מכין את התמונות...");
    try {
      const prepared = await prepareLeakPhotos(supabase, survey, (done, total) =>
        setBuilding(`מכין תמונה ${done} מתוך ${total}...`)
      );
      setBuilding("בונה את הדוח...");
      const how = await deliverLeakReport(survey, biz, prepared);
      if (how === "downloaded") toast.success("הדוח ירד למכשיר — אפשר לצרף אותו לשיחה");
      else if (how === "shared") {
        toast.success("הדוח נשלח");
        await save({ sent_at: new Date().toISOString(), sent_to: survey.customer_phone });
      }
    } catch (e) {
      toast.error(errorMessage(e, "לא הצלחנו לבנות את הדוח"));
    } finally {
      setBuilding(null);
    }
  }

  if (loading) {
    return <p className="mx-auto max-w-3xl p-4 text-sm text-ink-400">טוען...</p>;
  }
  if (!survey) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-4">
        <p className="text-sm text-ink-500">הסקר לא נמצא.</p>
        <Link href="/leaks" className="btn-secondary px-4 py-2.5 text-sm">
          <ArrowRight className="h-4 w-4" /> חזרה לאיתור נזילות
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            href="/leaks"
            className="mb-1 inline-flex items-center gap-1 text-xs font-bold text-ink-400 hover:text-ink-700"
          >
            <ArrowRight className="h-3.5 w-3.5" /> איתור נזילות
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold text-ink-900">
            <Droplets className="h-6 w-6 text-brand-600" /> דוח {survey.survey_number}
          </h1>
        </div>
        <button
          onClick={() => setConfirmDelete(true)}
          className="rounded-lg p-2 text-ink-300 hover:bg-ink-100 hover:text-danger-600"
          aria-label="מחיקת הסקר"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* ---- who and where ---- */}
      <Card>
        <CardHeader>
          <CardTitle>פרטי הלקוח והנכס</CardTitle>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label required>שם הלקוח</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name !== survey.customer_name && save({ customer_name: name.trim() })}
            />
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
              onBlur={() => phone !== (survey.customer_phone ?? "") && save({ customer_phone: phone.trim() || null })}
              placeholder="050-0000000"
            />
          </div>
          <div>
            <Label>כתובת הנכס</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onBlur={() =>
                address !== (survey.customer_address ?? "") &&
                save({ customer_address: address.trim() || null })
              }
              placeholder="רחוב, מספר, עיר"
            />
          </div>
          <div>
            <Label required>תאריך הבדיקה</Label>
            <Input
              type="date"
              value={surveyedOn}
              onChange={(e) => {
                setSurveyedOn(e.target.value);
                if (e.target.value) save({ surveyed_on: e.target.value });
              }}
            />
          </div>
        </CardBody>
      </Card>

      {/* ---- the photographs ---- */}
      <Card>
        <CardHeader>
          <CardTitle>
            תמונות מהבדיקה
            {photos.length > 0 && (
              <span className="mr-2 text-xs font-bold text-ink-400">
                {photos.length} תמונות · {findings} מסומנות
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-500">
            מעלים תמונות מהבית, ועל כל תמונה שיש בה נזילה לוחצים בדיוק במקום שלה — שם יופיע החץ
            האדום בדוח. תמונה בלי סימון נכנסת לדוח כתיעוד, בלי חץ.
          </p>
          {photos.map((p, i) => (
            <LeakPhotoCard
              key={p.id}
              photo={p}
              url={urls[p.id] ?? null}
              index={i}
              busy={busy}
              onMark={(x, y) => markPhoto(p.id, x, y)}
              onClearMark={() => markPhoto(p.id, null, null)}
              onField={(field, value) =>
                updatePhoto(supabase, p.id, { [field]: value.trim() || null }).then(load)
              }
              onDelete={() => removePhoto(p.id)}
            />
          ))}
          <AddPhotosButton
            onFiles={addPhotos}
            busy={uploading}
            label={photos.length ? "הוספת עוד תמונות" : "העלאת תמונות"}
          />
        </CardBody>
      </Card>

      {/* ---- the verdict ---- */}
      <Card>
        <CardHeader>
          <CardTitle>מה נמצא</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => save({ found: true })}
              className={`flex items-center gap-2 rounded-xl border px-3.5 py-3 text-right text-sm font-bold transition ${
                survey.found === true
                  ? "border-danger-500 bg-danger-50 text-danger-700"
                  : "border-ink-200 text-ink-600 hover:bg-ink-50"
              }`}
            >
              <Check className={`h-4 w-4 ${survey.found === true ? "" : "opacity-0"}`} />
              נמצאו ממצאי נזילה
            </button>
            <button
              type="button"
              onClick={() => save({ found: false })}
              className={`flex items-center gap-2 rounded-xl border px-3.5 py-3 text-right text-sm font-bold transition ${
                survey.found === false
                  ? "border-success-600 bg-success-50 text-success-700"
                  : "border-ink-200 text-ink-600 hover:bg-ink-50"
              }`}
            >
              <Check className={`h-4 w-4 ${survey.found === false ? "" : "opacity-0"}`} />
              לא נמצאו ממצאים
            </button>
          </div>

          {survey.found == null && (
            <p className="rounded-xl border border-warning-100 bg-warning-50 px-3.5 py-2.5 text-xs text-ink-700">
              צריך לבחור אחד מהשניים — בלי זה הדוח ייצא בלי תשובה ברורה ללקוח.
            </p>
          )}
          {survey.found === true && findings === 0 && photos.length > 0 && (
            <p className="rounded-xl border border-warning-100 bg-warning-50 px-3.5 py-2.5 text-xs text-ink-700">
              סימנתם שנמצאו ממצאים, אבל אין עדיין חץ על אף תמונה. כדאי ללחוץ על כל תמונה במקום
              הנזילה.
            </p>
          )}

          <div>
            <Label>ממצאים — מה נמצא ואיך</Label>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              onBlur={() => summary !== (survey.summary ?? "") && save({ summary: summary.trim() || null })}
              placeholder="למשל: נמצאה רטיבות פעילה בקיר המשותף בין המקלחת לחדר השינה, באמצעות מצלמה תרמית ומד לחות."
            />
          </div>
          <div>
            <Label>המלצות</Label>
            <Textarea
              value={recommendation}
              onChange={(e) => setRecommendation(e.target.value)}
              onBlur={() =>
                recommendation !== (survey.recommendation ?? "") &&
                save({ recommendation: recommendation.trim() || null })
              }
              placeholder="למשל: פתיחת הקיר באזור המסומן והחלפת הצנרת. מומלץ לבצע בהקדם כדי למנוע נזק לריצוף."
            />
          </div>
        </CardBody>
      </Card>

      {/* ---- sending ---- */}
      <Card>
        <CardHeader>
          <CardTitle>שליחה ללקוח</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          <p className="text-sm text-ink-500">
            {shareable
              ? "שני שלבים: פותחים את השיחה עם הלקוח, ואז שולחים לו את הדוח."
              : "פותחים את השיחה עם הלקוח, מורידים את הדוח ומצרפים אותו לשיחה."}
          </p>

          {wa ? (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setChatOpened(true)}
              className={`${chatOpened ? "btn-secondary" : "btn-success"} w-full px-4 py-2.5 text-[15px]`}
            >
              {chatOpened ? <Check className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
              {chatOpened ? "השיחה נפתחה" : "1. פתיחת השיחה בוואטסאפ"}
            </a>
          ) : (
            <p className="rounded-xl border border-warning-100 bg-warning-50 px-3.5 py-2.5 text-sm text-ink-700">
              אין טלפון ללקוח, אז אי אפשר לפתוח שיחה מכאן — אפשר להוריד את הדוח ולשלוח איך שנוח.
            </p>
          )}

          <Button
            fullWidth
            variant={chatOpened || !wa ? "primary" : "secondary"}
            disabled={!!building || photos.length === 0}
            onClick={sendReport}
          >
            {building ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : shareable ? (
              <Share2 className="h-4 w-4" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            {building ?? `${wa ? "2. " : ""}${shareable ? "שליחת הדוח (PDF)" : "הורדת הדוח (PDF)"}`}
          </Button>

          {photos.length === 0 && (
            <p className="text-xs text-ink-400">צריך לפחות תמונה אחת לפני שאפשר להפיק דוח.</p>
          )}
          {survey.sent_at && (
            <p className="text-xs text-success-700">
              הדוח נשלח ב־{plainDate(survey.sent_at)}
              {survey.sent_to ? ` אל ${survey.sent_to}` : ""}.
            </p>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await deleteSurvey(supabase, survey);
            router.push("/leaks");
          } catch (e) {
            toast.error(errorMessage(e, "לא הצלחנו למחוק"));
            setBusy(false);
          }
        }}
        loading={busy}
        title={`למחוק את דוח ${survey.survey_number}?`}
        description="הסקר וכל התמונות שלו יימחקו לצמיתות. דוח שכבר נשלח ללקוח נשאר אצלו."
        confirmLabel="מחיקה"
      />
    </div>
  );
}
