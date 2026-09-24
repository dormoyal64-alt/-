import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** One conversation, as a person should read it back. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const [conv, msgs, acts] = await Promise.all([
    supabase.from("agent_conversations").select("*").eq("id", params.id).maybeSingle(),
    supabase
      .from("agent_messages")
      .select("id, role, text, created_at")
      .eq("conversation_id", params.id)
      .order("created_at"),
    supabase
      .from("agent_actions")
      .select("id, tool_name, summary, status, error, created_at")
      .eq("conversation_id", params.id)
      .order("created_at"),
  ]);

  if (!conv.data) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    conversation: conv.data,
    // the empty rows are the tool-result carriers, which are not for reading
    messages: ((msgs.data as { text: string | null }[]) ?? []).filter((m) => (m.text ?? "").trim()),
    actions: acts.data ?? [],
  });
}
