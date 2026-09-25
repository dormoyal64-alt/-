import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adsConfig, israelDate, spendForDay } from "@/lib/ads/google";

/**
 * The nightly reading of what advertising cost.
 *
 * It runs here rather than in the scheduler so that the only thing the
 * scheduler holds is a password to ring this doorbell. Every real credential —
 * Google's, and the database's — stays on the server the business already
 * trusts with them, and none of them is ever in a place where a repository's
 * logs could print it.
 *
 * It reads yesterday rather than today on purpose. A day that has not ended
 * has not finished spending, and Google keeps adjusting a day's figures for a
 * while after it closes; a number taken at midnight for the day just starting
 * would be zero, and one taken for the day just ending would be provisional.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const given =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  // same length or not, the comparison should not say which
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }

  const config = adsConfig();
  if (!config) {
    return NextResponse.json(
      { ok: false, error: "Google Ads is not configured on this server" },
      { status: 503 }
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set on this server" },
      { status: 503 }
    );
  }

  // a day may be named, so a day that was missed can be filled in later
  const asked = new URL(request.url).searchParams.get("day");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(asked ?? "") ? asked! : israelDate(-1);

  let agorot: number;
  try {
    agorot = await spendForDay(config, day);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, day, error: detail }, { status: 502 });
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("record_ad_spend_day", {
    p_day: day,
    p_amount_agorot: agorot,
    p_source: "google_ads",
    p_notes: "Google Ads — נרשם אוטומטית",
  });

  if (error) {
    return NextResponse.json({ ok: false, day, agorot, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, day, agorot, shekels: agorot / 100, row: data });
}
