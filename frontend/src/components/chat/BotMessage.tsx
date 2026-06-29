"use client";

import type { ReactNode } from "react";
import { Markdown } from "./Markdown";

/** Bazak's avatar — indigo "B" normally, amber "!" for the error tone. */
function Avatar({ tone }: { tone: "default" | "error" }) {
  return (
    <div
      className={`w-7 h-7 rounded-lg text-white grid place-items-center text-xs font-bold shrink-0 ${
        tone === "error" ? "bg-amber-500" : "bg-bazak"
      }`}
      aria-hidden="true"
    >
      {tone === "error" ? "!" : "B"}
    </div>
  );
}

/**
 * An assistant turn — left-aligned bubble + avatar. One component covers every
 * documented variant: the normal slate bubble (summary / off-catalog decline /
 * chit-chat, US-4.x) and the amber error fallback with a Retry button (US-5.2).
 * Grounded text only — the component never invents data (US-5.1).
 */
export function BotMessage({
  text,
  children,
  tone = "default",
  onRetry,
}: {
  text?: string;
  children?: ReactNode;
  tone?: "default" | "error";
  onRetry?: () => void;
}) {
  const isError = tone === "error";
  return (
    <div className="flex gap-2.5">
      <Avatar tone={tone} />
      <div
        className={`rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm max-w-[85%] break-words ${
          isError
            ? "bg-amber-50 border border-amber-200 text-amber-900"
            : "bg-slate-100 text-slate-800"
        }`}
      >
        {text && <Markdown text={text} />}
        {children}
        {isError && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="block mt-2 bg-white border border-amber-300 text-amber-800 rounded-lg px-3 py-1 text-xs font-medium hover:bg-amber-100"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
