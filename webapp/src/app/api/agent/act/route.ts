import { NextRequest, NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { runTurn, agentConfigured } from "@/lib/agent/run";
import { TOOLS_BY_NAME } from "@/lib/agent/tools";
import type { AppSettings } from "@/lib/types";

/**
 * The answer to "shall I?".
 *
 * Nothing the assistant proposes happens anywhere else. A writing tool is
 * executed here and only here, after a person has read what it would do and
 * said yes — which is why the decision travels as its own request rather than
 * living inside the model's loop.
 *
 * A refusal is not silence: the model is told it was declined, so it can say
 * so and offer something else rather than trying the same thing again.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ActionRow {
  id: string;
  conversation_id: string;
  message_id: string | null;
  tool_use_id: string | null;
  tool_name: string;
  input: Record<string, unknown>;
  status: string;
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "לא מחוברים למערכת" }, { status: 401 });
  if (!agentConfigured()) {
    return NextResponse.json({ ok: false, error: "העוזר לא מוגדר" }, { status: 503 });
  }

  let body: { actionId?: string; approve?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "בקשה לא תקינה" }, { status: 400 });
  }
  if (!body.actionId) return NextResponse.json({ ok: false, error: "חסר מזהה פעולה" }, { status: 400 });

  const { data: actionRow } = await supabase
    .from("agent_actions")
    .select("*")
    .eq("id", body.actionId)
    .maybeSingle();
  const action = actionRow as ActionRow | null;
  if (!action) return NextResponse.json({ ok: false, error: "הפעולה לא נמצאה" }, { status: 404 });
  if (action.status !== "pending") {
    // an approval that arrives twice must not run the job twice
    return NextResponse.json({ ok: false, error: "הפעולה כבר טופלה" }, { status: 409 });
  }

  const approved = body.approve === true;
  let resultForModel: string;
  let isError = false;

  if (!approved) {
    await supabase
      .from("agent_actions")
      .update({ status: "rejected", decided_at: new Date().toISOString() })
      .eq("id", action.id)
      .eq("status", "pending");
    resultForModel = "בעל העסק לא אישר את הפעולה. אל תנסה לבצע אותה שוב — שאל מה הוא רוצה במקום.";
  } else {
    const tool = TOOLS_BY_NAME.get(action.tool_name);
    if (!tool) {
      await supabase.from("agent_actions").update({ status: "failed", error: "unknown tool" }).eq("id", action.id);
      return NextResponse.json({ ok: false, error: "פעולה לא מוכרת" }, { status: 400 });
    }
    // claim it first, so two taps cannot both execute
    const { data: claimed } = await supabase
      .from("agent_actions")
      .update({ status: "approved", decided_at: new Date().toISOString() })
      .eq("id", action.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) return NextResponse.json({ ok: false, error: "הפעולה כבר טופלה" }, { status: 409 });

    try {
      const out = await tool.run(supabase, action.input);
      await supabase
        .from("agent_actions")
        .update({ status: "done", result: out as Record<string, unknown> })
        .eq("id", action.id);
      resultForModel = JSON.stringify(out);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await supabase.from("agent_actions").update({ status: "failed", error: message }).eq("id", action.id);
      resultForModel = message;
      isError = true;
    }
  }

  // every call from that paused turn goes back together, as the API requires
  const { data: siblingRows } = await supabase
    .from("agent_actions")
    .select("*")
    .eq("message_id", action.message_id)
    .order("created_at");
  const siblings = (siblingRows as ActionRow[] | null) ?? [];

  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const s of siblings) {
    if (!s.tool_use_id) continue;
    if (s.id === action.id) {
      results.push({
        type: "tool_result",
        tool_use_id: s.tool_use_id,
        ...(isError ? { is_error: true } : {}),
        content: resultForModel,
      });
      continue;
    }
    const row = s as ActionRow & { result?: unknown; error?: string | null; status: string };
    if (row.status === "done") {
      results.push({ type: "tool_result", tool_use_id: s.tool_use_id, content: JSON.stringify(row.result ?? {}) });
    } else if (row.status === "failed") {
      results.push({ type: "tool_result", tool_use_id: s.tool_use_id, is_error: true, content: row.error ?? "failed" });
    } else if (row.status === "pending") {
      // another proposal from the same turn is still waiting; answering one
      // does not answer the rest
      results.push({
        type: "tool_result",
        tool_use_id: s.tool_use_id,
        content: "עדיין ממתין לאישור בעל העסק.",
      });
    } else {
      results.push({ type: "tool_result", tool_use_id: s.tool_use_id, content: "בעל העסק לא אישר." });
    }
  }

  const { data: settingsRow } = await supabase.from("app_settings").select("*").eq("id", true).maybeSingle();

  try {
    const turn = await runTurn(supabase, {
      conversationId: action.conversation_id,
      channel: "operator",
      settings: settingsRow as AppSettings | null,
      resume: results,
    });
    return NextResponse.json({ ok: true, conversationId: action.conversation_id, ...turn });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    // the action itself already happened; only the model's follow-up failed
    return NextResponse.json(
      {
        ok: true,
        conversationId: action.conversation_id,
        reply: approved
          ? `הפעולה בוצעה. (לא הצלחתי לנסח תשובה: ${detail})`
          : "הפעולה בוטלה.",
        pending: null,
        spent_agorot: 0,
        cap_agorot: 0,
      },
      { status: 200 }
    );
  }
}
