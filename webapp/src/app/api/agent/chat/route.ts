import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runTurn, agentConfigured, agentModel } from "@/lib/agent/run";
import type { AppSettings } from "@/lib/types";

/**
 * The assistant, talking.
 *
 * It runs on the server because the API key does, and it reads and writes
 * through the caller's own session, so the assistant can reach exactly what
 * the person asking could reach and nothing more. A key that the browser never
 * sees, and a set of doors that row level security still guards.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ configured: false }, { status: 401 });

  const { data } = await supabase.from("app_settings").select("*").eq("id", true).maybeSingle();
  const settings = data as AppSettings | null;
  const { data: spent } = await supabase.rpc("agent_spend_this_month");

  return NextResponse.json({
    configured: agentConfigured() && (settings?.agent_enabled ?? true),
    model: agentModel(),
    spent_agorot: Number(spent ?? 0),
    cap_agorot: Number(settings?.agent_monthly_cap_agorot ?? 10000),
  });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "לא מחוברים למערכת" }, { status: 401 });

  if (!agentConfigured()) {
    return NextResponse.json(
      { ok: false, error: "העוזר לא מוגדר — חסר מפתח API" },
      { status: 503 }
    );
  }

  let body: { conversationId?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "בקשה לא תקינה" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ ok: false, error: "אין הודעה" }, { status: 400 });

  const { data: settingsRow } = await supabase.from("app_settings").select("*").eq("id", true).maybeSingle();
  const settings = settingsRow as AppSettings | null;
  if (settings && settings.agent_enabled === false) {
    return NextResponse.json({ ok: false, error: "העוזר כבוי בהגדרות" }, { status: 503 });
  }

  // the ceiling is checked before anything is spent, not after
  const { data: spentNow } = await supabase.rpc("agent_spend_this_month");
  const cap = Number(settings?.agent_monthly_cap_agorot ?? 10000);
  if (Number(spentNow ?? 0) >= cap) {
    return NextResponse.json(
      {
        ok: false,
        error: "נגמרה התקרה החודשית של העוזר. אפשר להעלות אותה בהגדרות.",
        spent_agorot: Number(spentNow ?? 0),
        cap_agorot: cap,
      },
      { status: 402 }
    );
  }

  let conversationId = body.conversationId;
  if (!conversationId) {
    const { data, error } = await supabase
      .from("agent_conversations")
      .insert({ channel: "operator", title: message.slice(0, 60) })
      .select("id")
      .single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    conversationId = (data as { id: string }).id;
  }

  try {
    const result = await runTurn(supabase, {
      conversationId: conversationId!,
      channel: "operator",
      settings,
      userText: message,
    });
    await supabase
      .from("agent_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId!);
    return NextResponse.json({ ok: true, conversationId, ...result });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `העוזר נתקל בשגיאה: ${detail}` }, { status: 502 });
  }
}
