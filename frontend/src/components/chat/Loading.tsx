/**
 * The "thinking" state: typing dots in the bot's position plus a visible status
 * label (not animation-only — a11y) and, when product results are expected, a few
 * skeleton cards. Mirrors `UX/mocks` state · Awaiting reply.
 */
export function Loading({
  status = "Searching the catalog…",
  showSkeletons = true,
}: {
  status?: string;
  showSkeletons?: boolean;
}) {
  return (
    <div className="space-y-4" data-testid="loading">
      <div className="flex gap-2.5 items-center">
        <div className="w-7 h-7 rounded-lg bg-bazak text-white grid place-items-center text-xs font-bold shrink-0">
          B
        </div>
        <div
          className="bg-slate-100 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5"
          role="status"
          aria-label="Bazak is thinking"
        >
          <span className="dot w-2 h-2 rounded-full bg-slate-400" />
          <span className="dot w-2 h-2 rounded-full bg-slate-400" />
          <span className="dot w-2 h-2 rounded-full bg-slate-400" />
        </div>
        <span className="text-xs text-slate-400">{status}</span>
      </div>

      {showSkeletons && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-slate-200 p-2.5">
              <div className="skeleton aspect-square rounded mb-2" />
              <div className="skeleton h-3 rounded w-3/4 mb-1.5" />
              <div className="skeleton h-3 rounded w-1/3" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
