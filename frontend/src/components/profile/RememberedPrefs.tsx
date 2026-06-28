"use client";

import { useCallback, useEffect, useState } from "react";
import { type ProfileField, getProfile, resetProfile } from "@/api-client/profile";

/**
 * The "what Bazak remembers about you" view + reset (US-7.4). A disclosure in the
 * header: opening it reads working memory (GET /profile); Reset clears it
 * (DELETE /profile). Read-only — per-field editing is deferred (FUTURE.md).
 */
export function RememberedPrefs() {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<ProfileField[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      setFields(await getProfile());
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function onReset() {
    try {
      await resetProfile();
      setFields([]);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-xs text-slate-500 hover:text-bazak font-medium"
      >
        Remembered
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-lg p-4 z-10 text-left"
          role="dialog"
          aria-label="Remembered preferences"
        >
          <p className="text-xs font-semibold text-slate-900 mb-2">What Bazak remembers</p>

          {status === "loading" ? (
            <p className="text-xs text-slate-400">Loading…</p>
          ) : status === "error" ? (
            <p className="text-xs text-slate-500">Couldn&apos;t read your preferences.</p>
          ) : fields.length === 0 ? (
            <p className="text-xs text-slate-500">Nothing remembered yet — tell me your budget or favourite brands.</p>
          ) : (
            <dl className="space-y-1.5 mb-3">
              {fields.map((f) => (
                <div key={f.label} className="text-xs">
                  <dt className="text-slate-400 uppercase tracking-wide text-[10px]">{f.label}</dt>
                  <dd className="text-slate-800">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {fields.length > 0 && status === "idle" && (
            <button
              type="button"
              onClick={onReset}
              className="text-xs text-rose-600 hover:underline font-medium"
            >
              Reset everything
            </button>
          )}
        </div>
      )}
    </div>
  );
}
