"use client";

import { useSyncExternalStore } from "react";
import type { JourneyEngine } from "@/lib/engine/JourneyEngine";
import { formatClock } from "@/lib/journey/types";

const RATES = [0.5, 1, 2, 4, 8];

export default function TimelineBar({ engine }: { engine: JourneyEngine | null }) {
  const hud = useSyncExternalStore(
    (cb) => engine?.subscribe(cb) ?? (() => {}),
    () => engine?.getHud() ?? null,
    () => null
  );

  const disabled = !engine || !hud?.hasJourney;
  const pct = hud && hud.duration > 0 ? (hud.time / hud.duration) * 100 : 0;

  return (
    <div className="flex h-full items-center gap-3 border-t border-[#232c3d] bg-[#10151f] px-4">
      <button
        aria-label="Restart"
        disabled={disabled}
        onClick={() => engine?.restart()}
        className="grid h-9 w-9 place-items-center rounded-lg text-slate-300 transition hover:bg-[#1c2436] hover:text-white disabled:opacity-35"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path
            d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        aria-label={hud?.playing ? "Pause" : "Play"}
        onClick={() => (hud?.playing ? engine?.pause() : engine?.play())}
        disabled={disabled}
        className="grid h-11 w-11 place-items-center rounded-xl bg-amber-400 text-[#14100a] shadow-[0_2px_14px_rgba(255,181,71,0.35)] transition hover:bg-amber-300 disabled:opacity-40 disabled:shadow-none"
      >
        {hud?.playing ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <rect x="5" y="4" width="5" height="16" rx="1.4" />
            <rect x="14" y="4" width="5" height="16" rx="1.4" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 4.8v14.4a1 1 0 0 0 1.53.85l11.2-7.2a1 1 0 0 0 0-1.7L8.53 3.95A1 1 0 0 0 7 4.8Z" />
          </svg>
        )}
      </button>

      <div className="ml-1 w-[74px] shrink-0 font-mono text-[13px] tabular-nums text-slate-300">
        {hud && isFinite(hud.clockMs) ? formatClock(hud.clockMs) : "--:--"}
      </div>

      <input
        type="range"
        min={0}
        max={100}
        step={0.05}
        value={pct}
        disabled={disabled}
        onChange={(e) => {
          if (!engine || !hud) return;
          engine.seek((parseFloat(e.target.value) / 100) * hud.duration);
        }}
        style={{ ["--fill" as never]: `${pct}%` }}
        className="h-[5px] flex-1 rounded-full"
      />

      <div className="w-[86px] shrink-0 font-mono text-[12px] tabular-nums text-slate-500">
        {hud ? `${Math.round(pct)}% · ${hud.distanceKm.toFixed(1)}km` : "—"}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-[#0d1220] p-1">
        {RATES.map((r) => (
          <button
            key={r}
            disabled={disabled}
            onClick={() => engine?.setRate(r)}
            className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
              hud?.rate === r
                ? "bg-[#26314b] text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {r}×
          </button>
        ))}
      </div>
    </div>
  );
}
