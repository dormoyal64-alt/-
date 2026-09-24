import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The recent conversations, newest first. */
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ conversations: [] }, { status: 401 });

  const { data } = await supabase
    .from("agent_conversations")
    .select("id, title, status, updated_at")
    .order("updated_at", { ascending: false })
    .limit(20);

  return NextResponse.json({ conversations: data ?? [] });
}
