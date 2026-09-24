"use client";

import { Bot, Sparkles } from "lucide-react";
import clsx from "clsx";
import { Spinner } from "@/components/ui/Misc";

/**
 * A line in the transcript.
 *
 * 'note' is the screen's own voice, not the model's: what was approved, what
 * was refused, what a tool came back saying it could not do. It is kept in the
 * same list as the conversation because that is where it happened, and reading
 * the two apart is what the styling is for.
 */
export interface ChatLine {
  id: string;
  role: "user" | "assistant" | "note";
  text: string;
}

/**
 * The conversation so far.
 *
 * The owner's own words sit on the start side of the line, where the reader's
 * eye already is in Hebrew; the assistant answers from the other side in white,
 * signed with an icon, so at a glance it is obvious who said what without
 * reading a word. Every bubble wraps rather than stretches — on a phone the
 * assistant's answer is often a sentence about a job number and an amount, and
 * a bubble that widened to fit it would take the whole page sideways with it.
 */
export function ChatTranscript({
  lines,
  thinking,
  emptyHint,
}: {
  lines: ChatLine[];
  /** the server is working; it can take several seconds */
  thinking: boolean;
  emptyHint: string;
}) {
  if (lines.length === 0 && !thinking) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <Sparkles className="h-6 w-6" />
        </span>
        <p className="font-bold text-ink-700">העוזר מחכה לשאלה</p>
        <p className="max-w-xs break-words text-sm text-ink-400">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {lines.map((line) => {
        if (line.role === "note") {
          return (
            <p
              key={line.id}
              className="mx-auto max-w-[95%] break-words rounded-xl bg-ink-100 px-3 py-1.5 text-center text-xs font-semibold text-ink-600"
            >
              {line.text}
            </p>
          );
        }
        const mine = line.role === "user";
        return (
          <div
            key={line.id}
            className={clsx(
              "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[15px] leading-6",
              mine
                ? // the start side is the right one in RTL: the owner's own words
                  "self-start bg-brand-600 text-white"
                : "self-end border border-ink-100 bg-white text-ink-800 shadow-card"
            )}
          >
            {!mine && (
              <span className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-brand-600">
                <Bot className="h-3.5 w-3.5" /> העוזר
              </span>
            )}
            {line.text}
          </div>
        );
      })}

      {thinking && (
        <div className="self-end flex items-center gap-2 rounded-2xl border border-ink-100 bg-white px-3.5 py-2.5 shadow-card">
          <Spinner className="h-4 w-4" />
          <span className="text-sm font-semibold text-ink-500">העוזר בודק במערכת... זה יכול לקחת כמה שניות</span>
        </div>
      )}
    </div>
  );
}
