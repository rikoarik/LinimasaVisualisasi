"use client";

import { useRef } from "react";
import type { MapStyleId, TripOption, VehicleKind } from "@/lib/journey/types";
import { VEHICLE_KINDS, VEHICLE_LABEL } from "@/lib/journey/types";
import type { WorldToggles } from "../MapStage";

const STYLES: { id: MapStyleId; label: string }[] = [
  { id: "cinematic", label: "Cinematic" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "minimal", label: "Minimal" },
  { id: "bright", label: "Bright" },
  { id: "satellite", label: "Satellite" },
];

interface Props {
  jsonText: string;
  onJsonText: (v: string) => void;
  onLoadJson: () => void;
  onLoadFile: (file: File) => void;
  onLoadDemo: () => void;
  trips: TripOption[];
  activeTripId: string | null;
  onSelectTrip: (trip: TripOption) => void;
  parseMsg: string | null;
  vehicleOverride: VehicleKind | "auto";
  onVehicleOverride: (v: VehicleKind | "auto") => void;
  styleId: MapStyleId;
  onStyleId: (s: MapStyleId) => void;
  world: WorldToggles;
  onWorld: (w: WorldToggles) => void;
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

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-[12px] font-medium transition ${
        value
          ? "border-[#33415c] bg-[#182034] text-slate-100"
          : "border-[#1e2637] bg-transparent text-slate-500 hover:text-slate-300"
      }`}
    >
      {label}
      <span
        className={`ml-2 h-[14px] w-[26px] rounded-full p-[2px] transition ${
          value ? "bg-amber-400" : "bg-[#2a3448]"
        }`}
      >
        <span
          className={`block h-[10px] w-[10px] rounded-full bg-white transition-transform ${
            value ? "translate-x-[12px]" : ""
          }`}
        />
      </span>
    </button>
  );
}

export default function LeftPanel(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <aside className="panel-scroll flex h-full w-[320px] shrink-0 flex-col border-r border-[#232c3d] bg-[#10151f]">
      <div className="border-b border-[#1b2333] px-4 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-[15px] font-black text-[#14100a]">
            3D
          </span>
          <div>
            <div className="text-[13.5px] font-bold leading-tight">Journey Visualizer</div>
            <div className="text-[11px] text-slate-500">GPS → cinematic 3D video</div>
          </div>
        </div>
      </div>

      <Section title="Journey JSON">
        <textarea
          value={p.jsonText}
          onChange={(e) => p.onJsonText(e.target.value)}
          spellCheck={false}
          placeholder={`{"title":"Jakarta → Bandung","vehicle":"motorcycle","points":[{"lat":-6.2088,"lng":106.8456,"timestamp":"2026-08-20T08:00:00"}]}`}
          className="h-[120px] w-full resize-y rounded-lg border border-[#232c3d] bg-[#0c111d] p-2.5 font-mono text-[11px] leading-relaxed text-slate-300 placeholder:text-slate-600 focus:border-[#39527e] focus:outline-none"
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={p.onLoadJson}
            className="flex-1 rounded-lg bg-amber-400 px-3 py-2 text-[12px] font-bold text-[#14100a] transition hover:bg-amber-300"
          >
            Load JSON
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-[#2a3448] px-3 py-2 text-[12px] font-semibold text-slate-300 transition hover:bg-[#1a2233]"
          >
            Upload…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) p.onLoadFile(f);
              e.target.value = "";
            }}
          />
        </div>
        <button
          onClick={p.onLoadDemo}
          className="mt-2 w-full rounded-lg border border-[#39527e] bg-[#141d31] px-3 py-2 text-[12px] font-semibold text-sky-300 transition hover:bg-[#18243c]"
        >
          ▶ Load Demo — Jakarta → Bogor → Puncak → Bandung
        </button>
        {p.parseMsg && (
          <div className="mt-2 rounded-lg border border-[#4a3a19] bg-[#241d0e] px-3 py-2 text-[11.5px] leading-snug text-amber-200/90">
            {p.parseMsg}
          </div>
        )}
      </Section>

      {p.trips.length > 0 && (
        <Section title={`Google Timeline trips (${p.trips.length})`}>
          <div className="panel-scroll max-h-[210px] space-y-1.5 pr-1">
            {p.trips.map((t) => (
              <button
                key={t.id}
                onClick={() => p.onSelectTrip(t)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                  p.activeTripId === t.id
                    ? "border-amber-400/70 bg-[#231d10]"
                    : "border-[#212a3d] bg-[#131928] hover:border-[#33415c]"
                }`}
              >
                <div className="text-[12px] font-semibold text-slate-200">{t.title}</div>
                <div className="mt-0.5 flex gap-2 text-[11px] text-slate-500">
                  <span>{t.distanceKm.toFixed(1)} km</span>
                  <span>·</span>
                  <span>{VEHICLE_LABEL[t.vehicle]}</span>
                  <span>·</span>
                  <span>{t.points.length} pts</span>
                </div>
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section title="Vehicle">
        <select
          value={p.vehicleOverride}
          onChange={(e) =>
            p.onVehicleOverride(e.target.value as VehicleKind | "auto")
          }
          className="w-full rounded-lg border border-[#232c3d] bg-[#0c111d] px-3 py-2 text-[12.5px] text-slate-200 focus:border-[#39527e] focus:outline-none"
        >
          <option value="auto">Auto-detect from data</option>
          {VEHICLE_KINDS.map((k) => (
            <option key={k} value={k}>
              {VEHICLE_LABEL[k]}
            </option>
          ))}
        </select>
      </Section>

      <Section title="Map Style">
        <div className="grid grid-cols-3 gap-1.5">
          {STYLES.map((s) => (
            <button
              key={s.id}
              onClick={() => p.onStyleId(s.id)}
              className={`rounded-lg border px-2 py-2 text-[11.5px] font-semibold transition ${
                p.styleId === s.id
                  ? "border-amber-400/70 bg-[#231d10] text-amber-200"
                  : "border-[#212a3d] text-slate-400 hover:border-[#33415c] hover:text-slate-200"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="3D World">
        <div className="grid grid-cols-2 gap-1.5">
          <Toggle
            label="Terrain"
            value={p.world.terrain}
            onChange={(v) => p.onWorld({ ...p.world, terrain: v })}
          />
          <Toggle
            label="Buildings"
            value={p.world.buildings}
            onChange={(v) => p.onWorld({ ...p.world, buildings: v })}
          />
          <Toggle
            label="Labels"
            value={p.world.labels}
            onChange={(v) => p.onWorld({ ...p.world, labels: v })}
          />
          <Toggle
            label="Route trail"
            value={p.world.trail}
            onChange={(v) => p.onWorld({ ...p.world, trail: v })}
          />
        </div>
      </Section>

      <div className="mt-auto px-4 py-3 text-[10.5px] leading-relaxed text-slate-600">
        Map data © OpenStreetMap · tiles by OpenFreeMap · terrain © Mapterhorn ·
        satellite © EOX
      </div>
    </aside>
  );
}
