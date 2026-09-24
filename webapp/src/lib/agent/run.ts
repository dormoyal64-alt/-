import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TOOLS_BY_NAME, toolSchemas } from "@/lib/agent/tools";
import { operatorSystemPrompt, customerSystemPrompt, summarizeActionHe, type BusinessContext } from "@/lib/agent/prompts";
import { DEFAULT_MODEL, costAgorot, readUsage } from "@/lib/agent/pricing";
import { BUSINESS_TIME_ZONE } from "@/lib/dates";
import type { AppSettings } from "@/lib/types";

/**
 * One turn of the assistant, and where it is made to stop.
 *
 * The loop is written out here rather than handed to the SDK's tool runner for
 * one reason: the pause. A call that would move money is not executed — it is
 * recorded and the turn ends, and the owner answers it in a browser, minutes
 * later, in a different request. A runner that drives itself to completion has
 * nowhere to put that gap.
 *
 * Three limits are enforced regardless of what the model decides: it may not
 * loop more than MAX_STEPS times, it may not run at all once the month's
 * ceiling is reached, and it may not execute a writing tool by itself. None of
 * those are asked for in the prompt, because a prompt is a request.
 */

const MAX_STEPS = 8;

export interface TurnResult {
  reply: string;
  pending: { id: string; tool_name: string; summary: string } | null;
  spent_agorot: number;
  cap_agorot: number;
}

export function agentConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function agentModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

function contextFrom(settings: AppSettings | null): BusinessContext {
  return {
    businessName: settings?.business_name?.trim() || "העסק",
    businessNumber: settings?.business_number?.trim() || "",
    phone: settings?.business_phone?.trim() || "",
    visitFeeText: settings?.visit_fee_agorot ? `${Math.round(settings.visit_fee_agorot / 100)} ₪` : "",
    today: new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TIME_ZONE }),
    timeZone: BUSINESS_TIME_ZONE,
  };
}

type Blocks = Anthropic.MessageParam["content"];

/** The conversation so far, as the API wants to receive it back. */
async function loadHistory(supabase: SupabaseClient, conversationId: string): Promise<Anthropic.MessageParam[]> {
  const { data } = await supabase
    .from("agent_messages")
    .select("role, blocks, text")
    .eq("conversation_id", conversationId)
    .order("created_at");
  return ((data as { role: string; blocks: unknown; text: string | null }[]) ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: (m.blocks as Blocks) ?? [{ type: "text" as const, text: m.text ?? "" }],
  }));
}

async function saveMessage(
  supabase: SupabaseClient,
  conversationId: string,
  role: "user" | "assistant",
  blocks: Blocks,
  text: string
): Promise<string> {
  const { data, error } = await supabase
    .from("agent_messages")
    .insert({ conversation_id: conversationId, role, blocks, text })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

async function spend(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase.rpc("agent_spend_this_month");
  return Number(data ?? 0);
}

/** Plain text out of a model turn, for the screen and for the log. */
function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * Drive the conversation until the model is done, or until it wants to do
 * something a person has to agree to.
 *
 * `resume` carries the results of a turn that was paused: the owner has now
 * answered, so those results go back as one user message and the model
 * continues from where it stopped.
 */
export async function runTurn(
  supabase: SupabaseClient,
  opts: {
    conversationId: string;
    channel: "operator" | "customer";
    settings: AppSettings | null;
    userText?: string;
    resume?: Anthropic.ToolResultBlockParam[];
  }
): Promise<TurnResult> {
  const cap = Number(opts.settings?.agent_monthly_cap_agorot ?? 10000);
  let spent = await spend(supabase);
  if (spent >= cap) {
    return { reply: "", pending: null, spent_agorot: spent, cap_agorot: cap };
  }

  // the base URL is named explicitly rather than left to the SDK's environment
  // conventions: it is what lets this be pointed at a gateway, and at a
  // stand-in server when the loop is exercised without spending anything
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
  });
  const model = agentModel();
  const ctx = contextFrom(opts.settings);
  const system = opts.channel === "customer" ? customerSystemPrompt(ctx) : operatorSystemPrompt(ctx);

  const messages = await loadHistory(supabase, opts.conversationId);

  if (opts.userText) {
    const blocks: Blocks = [{ type: "text", text: opts.userText }];
    await saveMessage(supabase, opts.conversationId, "user", blocks, opts.userText);
    messages.push({ role: "user", content: blocks });
  }
  if (opts.resume?.length) {
    // the tool results for a turn that was waiting on a person
    await saveMessage(supabase, opts.conversationId, "user", opts.resume as Blocks, "");
    messages.push({ role: "user", content: opts.resume as Blocks });
  }

  let reply = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      // the instructions and the tool list never change within a conversation,
      // so they are the cached prefix and cost a tenth of the rest
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: toolSchemas() as Anthropic.Tool[],
      messages,
    });

    const usage = readUsage(response.usage as unknown as Record<string, number>);
    const cost = costAgorot(model, usage);
    await supabase.from("agent_usage").insert({
      conversation_id: opts.conversationId,
      model,
      ...usage,
      cost_agorot: cost,
    });
    spent += cost;

    const text = textOf(response.content);
    if (text) reply = text;

    const messageId = await saveMessage(
      supabase,
      opts.conversationId,
      "assistant",
      response.content as Blocks,
      text
    );
    messages.push({ role: "assistant", content: response.content as Blocks });

    if (response.stop_reason !== "tool_use") return { reply, pending: null, spent_agorot: spent, cap_agorot: cap };

    const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const results: Anthropic.ToolResultBlockParam[] = [];
    let paused: { id: string; tool_name: string; summary: string } | null = null;

    for (const call of calls) {
      const tool = TOOLS_BY_NAME.get(call.name);
      const input = (call.input ?? {}) as Record<string, unknown>;

      if (!tool) {
        results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: "unknown tool" });
        continue;
      }

      if (tool.kind === "write") {
        // The card is the whole safety mechanism, so it has to name the thing
        // it would change. The model addresses a job by its id, which tells a
        // person nothing — so the job is read back and the sentence is given
        // the number and the customer the owner would recognise.
        let summary = summarizeActionHe(call.name, input);
        if (typeof input.job_id === "string") {
          const { data: j } = await supabase
            .from("jobs")
            .select("job_number, customer_name")
            .eq("id", input.job_id)
            .maybeSingle();
          const job = j as { job_number: string; customer_name: string } | null;
          if (job) {
            const named = `${job.job_number} (${job.customer_name})`;
            summary = summary.includes(job.job_number)
              ? summary
              : summary.replace(/העבודה המסומנת|העבודה הזאת|העבודה הזו/, named);
            if (!summary.includes(job.job_number)) summary = `${summary} — ${named}`;
          }
        }
        // recorded, described, and left for a person — every sibling result in
        // this turn is held with it, because the API wants them handed back
        // together once the answer comes
        const { data } = await supabase
          .from("agent_actions")
          .insert({
            conversation_id: opts.conversationId,
            message_id: messageId,
            tool_use_id: call.id,
            tool_name: call.name,
            input,
            summary,
            status: "pending",
            job_id: typeof input.job_id === "string" ? input.job_id : null,
          })
          .select("id, summary")
          .single();
        const row = data as { id: string; summary: string } | null;
        if (row && !paused) paused = { id: row.id, tool_name: call.name, summary: row.summary };
        continue;
      }

      // a reader runs at once
      try {
        const out = await tool.run(supabase, input);
        await supabase.from("agent_actions").insert({
          conversation_id: opts.conversationId,
          message_id: messageId,
          tool_use_id: call.id,
          tool_name: call.name,
          input,
          status: "done",
          result: out as Record<string, unknown>,
        });
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await supabase.from("agent_actions").insert({
          conversation_id: opts.conversationId,
          message_id: messageId,
          tool_use_id: call.id,
          tool_name: call.name,
          input,
          status: "failed",
          error: message,
        });
        results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: message });
      }
    }

    if (paused) {
      // the readers' results stay on their rows; the turn resumes from them
      return { reply, pending: paused, spent_agorot: spent, cap_agorot: cap };
    }

    if (spent >= cap) return { reply, pending: null, spent_agorot: spent, cap_agorot: cap };

    messages.push({ role: "user", content: results as Blocks });
    await saveMessage(supabase, opts.conversationId, "user", results as Blocks, "");
  }

  return {
    reply: reply || "לא הצלחתי לסיים את הפעולה. אפשר לנסח מחדש?",
    pending: null,
    spent_agorot: spent,
    cap_agorot: cap,
  };
}
