"use client";

import { type FormEvent, useState } from "react";

const PLACEHOLDER = "Ask for anything — e.g. 'show me cheaper' or 'the second one in red'";

/**
 * The message input. Submits on Enter or the send button; clears on send.
 *
 * Uncontrolled by default. Pass `value`/`onValueChange` to control it externally —
 * a suggestion chip prefills the draft this way (the user can edit before sending).
 */
export function Composer({
  onSend,
  disabled = false,
  placeholder = PLACEHOLDER,
  value: controlledValue,
  onValueChange,
}: {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  const [internalValue, setInternalValue] = useState("");
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;
  const setValue = (v: string) => {
    if (isControlled) onValueChange?.(v);
    else setInternalValue(v);
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }

  return (
    <form onSubmit={submit} className="p-4 border-t border-slate-100">
      <div className="flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-bazak/40">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label="Message Bazak"
          className="flex-1 bg-transparent text-sm focus:outline-none disabled:opacity-60"
          disabled={disabled}
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          aria-label="Send"
          className="bg-bazak hover:bg-bazak-dark text-white rounded-lg w-9 h-9 grid place-items-center shrink-0 transition disabled:opacity-50"
        >
          ↑
        </button>
      </div>
    </form>
  );
}
