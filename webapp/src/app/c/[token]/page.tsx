"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Loader2, Phone, ShieldCheck, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatAgorotPlain } from "@/lib/money";
import { formatAppointmentWindowHe } from "@/lib/dates";
import { buildCallLink } from "@/lib/whatsapp";

/**
 * The customer's own page — the only screen in this system nobody logs in to.
 *
 * It exists so that agreeing to the call-out fee costs the customer one tap
 * and the business nothing at all: no reply to read, no job to open, no second
 * message to send. The link's token is the whole of the authentication, and
 * the two functions behind it hand back only what this customer already knows.
 */

interface Order {
  job_number: string;
  customer_name: string;
  address: string;
  issue: string;
  scheduled_at: string | null;
  eta_window_minutes: number | null;
  confirmed_at: string | null;
  is_closed: boolean;
  technician: string;
  fee_agorot: number;
  contact_phone: string | null;
  business_name: string | null;
}

export default function ConfirmOrderPage() {
  const { token } = useParams<{ token: string }>();
  const supabase = useMemo(() => createClient(), []);
  const [order, setOrder] = useState<Order | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("order_for_confirmation", { p_token: token });
    if (error) return setState("error");
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return setState("missing");
    setOrder(row as Order);
    setState("ready");
  }, [supabase, token]);

  useEffect(() => {
    load();
  }, [load]);

  async function confirm() {
    setConfirming(true);
    setFailed(null);
    const { data, error } = await supabase.rpc("confirm_order", { p_token: token });
    setConfirming(false);
    if (error) {
      setFailed("לא הצלחנו לאשר. נסו שוב, או התקשרו אלינו.");
      return;
    }
    setOrder((prev) => (prev ? { ...prev, confirmed_at: String(data) } : prev));
  }

  if (state === "loading") {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 py-10 text-ink-400">
          <Loader2 className="h-5 w-5 animate-spin" /> טוען את פרטי ההזמנה…
        </div>
      </Shell>
    );
  }

  if (state === "missing" || state === "error" || !order) {
    return (
      <Shell>
        <div className="space-y-2 py-8 text-center">
          <p className="text-lg font-extrabold text-ink-900">הקישור אינו בתוקף</p>
          <p className="text-sm text-ink-500">
            ייתכן שההזמנה כבר טופלה, או שהקישור הועתק חלקית. אנא צרו איתנו קשר בטלפון.
          </p>
        </div>
      </Shell>
    );
  }

  const fee = formatAgorotPlain(order.fee_agorot ?? 49900);
  const eta = order.scheduled_at
    ? formatAppointmentWindowHe(order.scheduled_at, order.eta_window_minutes ?? 60)
    : "בהקדם — ניצור קשר לתיאום מדויק";
  const callLink = buildCallLink(order.contact_phone);

  if (order.confirmed_at) {
    return (
      <Shell businessName={order.business_name}>
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success-50 text-success-600">
              <Truck className="h-8 w-8" />
            </div>
            <p className="text-xl font-extrabold text-ink-900">ההזמנה אושרה</p>
          </div>
          <div className="space-y-3 rounded-2xl border border-success-100 bg-success-50/60 p-4 text-sm leading-6 text-ink-800">
            <p>
              שלום {order.customer_name}, ההזמנה אושרה ו{order.technician} יצא כעת לכתובת{" "}
              {order.address}.
            </p>
            <p>
              <b>זמן הגעה משוער:</b> {eta}.
            </p>
            <p>
              דמי הביקור והאבחון שאושרו הם <b>{fee}</b>. כל עבודה נוספת תתבצע רק לאחר הסבר
              וקבלת אישורך למחיר.
            </p>
            {order.contact_phone && (
              <p>לשינוי או לביטול ניתן ליצור קשר מיידי במספר {order.contact_phone}.</p>
            )}
          </div>
          {callLink && (
            <a href={callLink} className="btn-secondary flex w-full items-center justify-center gap-2 py-3">
              <Phone className="h-4 w-4" /> התקשרו אלינו
            </a>
          )}
          <p className="text-center text-xs text-ink-400">אפשר לסגור את החלון. אישור זה נשמר אצלנו.</p>
        </div>
      </Shell>
    );
  }

  if (order.is_closed) {
    return (
      <Shell businessName={order.business_name}>
        <p className="py-8 text-center text-sm text-ink-500">ההזמנה הזו כבר טופלה. תודה!</p>
      </Shell>
    );
  }

  return (
    <Shell businessName={order.business_name}>
      <div className="space-y-4">
        <div>
          <p className="text-lg font-extrabold text-ink-900">שלום {order.customer_name},</p>
          <p className="text-sm text-ink-500">להלן פרטי הזמנת השירות. נא לאשר כדי שנצא אליך.</p>
        </div>

        <div className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100">
          <Row label="כתובת השירות" value={order.address || "—"} />
          <Row label="סוג התקלה" value={order.issue || "לפי השיחה בטלפון"} />
          <Row label="מועד הגעה משוער" value={eta} />
          <Row label="מספר הזמנה" value={order.job_number} />
        </div>

        <div className="rounded-2xl border-2 border-brand-100 bg-brand-50/50 p-4">
          <p className="text-sm text-ink-600">דמי ביקור ואבחון</p>
          <p className="text-3xl font-extrabold text-brand-700">{fee}</p>
          <p className="mt-1.5 text-xs leading-5 text-ink-600">
            כולל כל מס החל. משולמים עבור הגעת בעל המקצוע ובדיקת התקלה — גם אם לאחר הבדיקה
            תבחר/י שלא להזמין עבודה נוספת. אם יידרשו עבודה, חלקים או ציוד נוסף, המחיר יימסר
            בנפרד ויבוצע רק לאחר אישורך.
          </p>
        </div>

        <p className="rounded-xl bg-ink-50 px-3.5 py-3 text-xs leading-5 text-ink-500">
          ניתן לבטל ללא חיוב כל עוד {order.technician} טרם יצא לדרך. לאחר היציאה, ובמקרה של
          ביטול, אי־זמינות או חוסר אפשרות לקבל גישה למקום, עשויים לחול דמי הביקור בסך {fee},
          בכפוף להוראות חוק הגנת הצרכן ולכל זכות ביטול שאינה ניתנת להתניה.
        </p>

        {failed && (
          <p className="rounded-xl bg-danger-50 px-3.5 py-3 text-sm font-bold text-danger-700">{failed}</p>
        )}

        <button
          onClick={confirm}
          disabled={confirming}
          className="btn-success flex w-full flex-col items-center gap-0.5 py-4 shadow-lg shadow-success-600/20"
        >
          <span className="flex items-center gap-2 text-lg">
            {confirming ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
            אני מאשר/ת את ההזמנה
          </span>
          <span className="text-xs font-semibold text-white/85">ואת דמי הביקור והאבחון בסך {fee}</span>
        </button>

        {callLink && (
          <a href={callLink} className="flex items-center justify-center gap-1.5 text-sm font-bold text-ink-500">
            <Phone className="h-4 w-4" /> יש שאלה? התקשרו אלינו
          </a>
        )}
      </div>
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-3.5 py-2.5">
      <span className="shrink-0 text-sm text-ink-500">{label}</span>
      <span className="text-left text-sm font-bold text-ink-900">{value}</span>
    </div>
  );
}

function Shell({ children, businessName }: { children: React.ReactNode; businessName?: string | null }) {
  return (
    <div className="min-h-screen bg-ink-50 px-4 py-6">
      <div className="mx-auto w-full max-w-md space-y-4">
        <div className="flex items-center justify-center gap-2 text-sm font-extrabold text-ink-500">
          <ShieldCheck className="h-4 w-4 text-brand-600" />
          {businessName?.trim() || "אישור הזמנת שירות"}
        </div>
        <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-ink-100 sm:p-5">{children}</div>
      </div>
    </div>
  );
}
