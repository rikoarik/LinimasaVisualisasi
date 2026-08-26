"use client";

import type { CameraPreset } from "@/lib/journey/types";
import { CAMERA_PRESETS } from "@/lib/journey/types";
import type {
  AspectId,
  ExportProgress,
  ExportSettings,
} from "@/lib/export/videoExport";

const PRESET_INFO: Record<CameraPreset, string> = {
  auto: "Chooses the best angle automatically",
  chase: "Behind & above, GTA-style",
  drone: "High follow, 45–70° pitch",
  side: "Tracking alongside the vehicle",
  top: "Almost directly overhead",
  orbit: "Slow orbit around the vehicle",
};

const ASPECTS: { id: AspectId; label: string; box: string }[] = [
  { id: "16:9", label: "Wide", box: "w-7 h-4" },
  { id: "9:16", label: "Story", box: "w-[13px] h-6" },
  { id: "1:1", label: "Square", box: "w-[19px] h-[19px]" },
  { id: "4:5", label: "Post", box: "w-4 h-5" },
];

interface Props {
  preset: CameraPreset;
  onPreset: (p: CameraPreset) => void;
  settings: ExportSettings;
  onSettings: (s: ExportSettings) => void;
  onExport: () => void;
  onCancelExport: () => void;
  exporting: boolean;
  progress: ExportProgress | null;
  downloadUrl: string | null;
  ext: string | null;
  canExport: boolean;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[#1b2333] px-4 py-4">
      <div className="mb-2.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-500">
        {title}
      </div>
      {children}
    </div>
  );
}

function Seg<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { v: T; l: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-[#0d1220] p-1">
      {options.map((o) => (
        <button
          key={String(o.v)}
          onClick={() => onChange(o.v)}
          className={`flex-1 rounded-md px-1.5 py-1.5 text-[11px] font-semibold transition ${
            value === o.v
              ? "bg-[#26314b] text-white"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

export default function RightPanel(p: Props) {
  const busy = p.exporting;

  return (
    <aside className="panel-scroll flex h-full w-[300px] shrink-0 flex-col border-l border-[#232c3d] bg-[#10151f]">
      <Section title="Camera">
        <div className="space-y-1.5">
          {CAMERA_PRESETS.map((c) => (
            <button
              key={c}
              disabled={busy}
              onClick={() => p.onPreset(c)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                p.preset === c
                  ? "border-sky-400/60 bg-[#101d2e]"
                  : "border-[#212a3d] hover:border-[#33415c]"
              }`}
            >
              <div
                className={`text-[12.5px] font-bold capitalize ${
                  p.preset === c ? "text-sky-300" : "text-slate-200"
                }`}
              >
                {c === "auto" ? "Cinematic Auto" : c === "chase" ? "Chase" : c === "drone" ? "Drone Follow" : c === "side" ? "Side Tracking" : c === "top" ? "Top Down" : "Orbit"}
              </div>
              <div className="text-[11px] leading-snug text-slate-500">
                {PRESET_INFO[c]}
              </div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Video">
        <div className="space-y-2.5">
          <div>
            <div className="mb-1 text-[11px] text-slate-500">Aspect</div>
            <div className="grid grid-cols-4 gap-1.5">
              {ASPECTS.map((a) => (
                <button
                  key={a.id}
                  disabled={busy}
                  onClick={() => p.onSettings({ ...p.settings, aspect: a.id })}
                  className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 transition ${
                    p.settings.aspect === a.id
                      ? "border-amber-400/70 bg-[#231d10]"
                      : "border-[#212a3d] hover:border-[#33415c]"
                  }`}
                >
                  <span
                    className={`${a.box} rounded-[3px] border-[1.6px] ${
                      p.settings.aspect === a.id ? "border-amber-300" : "border-slate-500"
                    }`}
                  />
                  <span
                    className={`text-[9.5px] font-bold ${
                      p.settings.aspect === a.id ? "text-amber-200" : "text-slate-500"
                    }`}
                  >
                    {a.id}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 text-[11px] text-slate-500">Quality</div>
            <Seg
              options={[
                { v: 720 as const, l: "720p" },
                { v: 1080 as const, l: "1080p" },
              ]}
              value={p.settings.resolution}
              onChange={(v) => p.onSettings({ ...p.settings, resolution: v })}
            />
          </div>

          <div>
            <div className="mb-1 text-[11px] text-slate-500">Frame rate</div>
            <Seg
              options={[
                { v: 30 as const, l: "30 fps" },
                { v: 60 as const, l: "60 fps" },
              ]}
              value={p.settings.fps}
              onChange={(v) => p.onSettings({ ...p.settings, fps: v })}
            />
          </div>

          <div>
            <div className="mb-1 text-[11px] text-slate-500">Duration</div>
            <Seg
              options={[
                { v: "auto" as const, l: "Auto" },
                { v: 30 as const, l: "30s" },
                { v: 60 as const, l: "60s" },
                { v: 120 as const, l: "2m" },
              ]}
              value={p.settings.durationSec}
              onChange={(v) =>
                p.onSettings({ ...p.settings, durationSec: v })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5 pt-0.5">
            <button
              disabled={busy}
              onClick={() =>
                p.onSettings({ ...p.settings, overlays: !p.settings.overlays })
              }
              className={`rounded-lg border px-2 py-2 text-[11.5px] font-semibold transition ${
                p.settings.overlays
                  ? "border-[#33415c] bg-[#182034] text-slate-100"
                  : "border-[#1e2637] text-slate-500"
              }`}
            >
              Overlays
            </button>
            <button
              disabled={busy}
              onClick={() =>
                p.onSettings({
                  ...p.settings,
                  letterbox: !p.settings.letterbox,
                })
              }
              className={`rounded-lg border px-2 py-2 text-[11.5px] font-semibold transition ${
                p.settings.letterbox
                  ? "border-[#33415c] bg-[#182034] text-slate-100"
                  : "border-[#1e2637] text-slate-500"
              }`}
            >
              Cinematic bars
            </button>
          </div>
        </div>
      </Section>

      <div className="px-4 py-4">
        {!busy ? (
          <button
            onClick={p.onExport}
            disabled={!p.canExport}
            className="w-full rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-3 text-[13px] font-black tracking-wide text-[#14100a] shadow-[0_4px_20px_rgba(255,150,40,0.28)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none"
          >
            ⬇ Export Video
          </button>
        ) : (
          <div className="space-y-2 rounded-xl border border-[#2a3448] bg-[#0d1220] p-3">
            <div className="flex items-center justify-between text-[11.5px] font-semibold text-slate-300">
              <span className="capitalize">{p.progress?.phase ?? "rendering"}…</span>
              <span className="font-mono tabular-nums text-slate-400">
                {Math.round(p.progress?.pct ?? 0)}%
              </span>
            </div>
            <div className="h-[6px] overflow-hidden rounded-full bg-[#1b2333]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-400 to-amber-400 transition-[width]"
                style={{ width: `${p.progress?.pct ?? 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10.5px] text-slate-500">
                frame {p.progress?.frame ?? 0}/{p.progress?.totalFrames ?? 0}
              </span>
              <button
                onClick={p.onCancelExport}
                className="rounded-md border border-[#3a2733] px-2 py-1 text-[10.5px] font-bold text-rose-300 hover:bg-[#241620]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {p.downloadUrl && !busy && (
          <a
            href={p.downloadUrl}
            download={`journey.${p.ext ?? "mp4"}`}
            className="mt-2 block w-full rounded-xl border border-emerald-500/50 bg-[#0f2018] px-4 py-2.5 text-center text-[12.5px] font-bold text-emerald-300 transition hover:bg-[#12281d]"
          >
            ✓ Download .{p.ext ?? "mp4"}
          </a>
        )}
      </div>

      <div className="mt-auto px-4 pb-3 text-[10.5px] leading-relaxed text-slate-600">
        Export renders every frame offline (WebCodecs) — faster than realtime in
        Chromium. Falls back to realtime capture elsewhere.
      </div>
    </aside>
  );
}
