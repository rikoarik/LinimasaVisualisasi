"use client";

import { useCallback, useRef, useState } from "react";
import MapStage, { type StageApi, type WorldToggles } from "./MapStage";
import TimelineBar from "./TimelineBar";
import LeftPanel from "./panels/LeftPanel";
import RightPanel from "./panels/RightPanel";
import {
  compileJourney,
} from "@/lib/journey/resample";
import {
  parseJourneyInput,
  tripToSpec,
} from "@/lib/journey/parse";
import type {
  CameraPreset,
  CompiledJourney,
  JourneySpec,
  MapStyleId,
  TripOption,
  VehicleKind,
} from "@/lib/journey/types";
import { VEHICLE_LABEL } from "@/lib/journey/types";
import {
  exportJourneyVideo,
  type ExportProgress,
  type ExportSettings,
} from "@/lib/export/videoExport";

export default function Editor() {
  const apiRef = useRef<StageApi | null>(null);
  const [ready, setReady] = useState(false);
  const [styleId, setStyleId] = useState<MapStyleId>("cinematic");
  const [world, setWorld] = useState<WorldToggles>({
    terrain: true,
    buildings: true,
    labels: false,
    trail: true,
  });
  const [preset, setPreset] = useState<CameraPreset>("auto");
  const [jsonText, setJsonText] = useState("");
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [parseMsg, setParseMsg] = useState<string | null>(null);
  const [vehicleOverride, setVehicleOverride] = useState<VehicleKind | "auto">("auto");
  const [currentTitle, setCurrentTitle] = useState<string | null>(null);
  const [settings, setSettings] = useState<ExportSettings>({
    aspect: "16:9",
    resolution: 1080,
    fps: 30,
    durationSec: "auto",
    overlays: true,
    letterbox: true,
  });
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [ext, setExt] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const loadSpec = useCallback(
    (spec: JourneySpec, tripId: string | null) => {
      const api = apiRef.current;
      if (!api) return;
      try {
        const withVehicle: JourneySpec = {
          ...spec,
          vehicle:
            vehicleOverride !== "auto"
              ? vehicleOverride
              : (spec.vehicle as VehicleKind | undefined),
        };
        const journey: CompiledJourney = compileJourney(withVehicle);
        if (vehicleOverride === "auto" && !withVehicle.vehicle) {
          journey.vehicle = "car";
        }
        api.loadJourney(journey, world.trail);
        setCurrentTitle(journey.title);
        setActiveTripId(tripId);
        setParseMsg(null);
        setDownloadUrl(null);
        setTimeout(() => {
          api.engine.applyFrame(true);
          api.engine.play();
        }, 350);
      } catch (e) {
        setParseMsg(e instanceof Error ? e.message : String(e));
      }
    },
    [vehicleOverride, world.trail]
  );

  const handleJsonText = useCallback(() => {
    const res = parseJourneyInput(jsonText);
    if (res.trips.length > 0) {
      setTrips(res.trips);
      setParseMsg(
        `Google Timeline detected — ${res.trips.length} trips found. Pick one below to visualize.`
      );
      return;
    }
    if (res.journeys.length > 0) {
      loadSpec(res.journeys[0], null);
      return;
    }
    setParseMsg(res.message ?? "Could not read journey JSON.");
  }, [jsonText, loadSpec]);

  const handleFile = useCallback(
    async (file: File) => {
      setParseMsg(`Reading ${file.name} (${(file.size / 1e6).toFixed(1)} MB)…`);
      try {
        const text = await file.text();
        setJsonText(text.length < 400_000 ? text : "");
        const res = parseJourneyInput(text);
        if (res.trips.length > 0) {
          setTrips(res.trips);
          setParseMsg(
            `Google Timeline detected — ${res.trips.length} trips found. Pick one below to visualize.`
          );
        } else if (res.journeys.length > 0) {
          loadSpec(res.journeys[0], null);
        } else {
          setParseMsg(res.message ?? "Could not read file.");
        }
      } catch (e) {
        setParseMsg(`Failed reading file: ${e instanceof Error ? e.message : e}`);
      }
    },
    [loadSpec]
  );

  const handleExport = useCallback(async () => {
    const api = apiRef.current;
    if (!api || !api.engine.journey) return;
    cancelRef.current = false;
    setExporting(true);
    setProgress({ phase: "preparing", frame: 0, totalFrames: 0, pct: 0 });
    setDownloadUrl(null);
    try {
      const result = await exportJourneyVideo({
        map: api.map,
        engine: api.engine,
        journey: api.engine.journey,
        overlayRenderer: api.overlay,
        styleId,
        settings,
        onProgress: setProgress,
        cancelled: () => cancelRef.current,
      });
      const url = URL.createObjectURL(result.blob);
      setDownloadUrl(url);
      setExt(result.ext);
    } catch (e) {
      if (!(e instanceof Error && e.message === "cancelled")) {
        setParseMsg(`Export failed: ${e instanceof Error ? e.message : e}`);
      }
    } finally {
      setExporting(false);
    }
  }, [settings, styleId]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1">
        <LeftPanel
          jsonText={jsonText}
          onJsonText={setJsonText}
          onLoadJson={handleJsonText}
          onLoadFile={handleFile}
          trips={trips}
          activeTripId={activeTripId}
          onSelectTrip={(t) => loadSpec(tripToSpec(t), t.id)}
          parseMsg={parseMsg}
          vehicleOverride={vehicleOverride}
          onVehicleOverride={setVehicleOverride}
          styleId={styleId}
          onStyleId={setStyleId}
          world={world}
          onWorld={setWorld}
        />

        <main className="relative min-w-0 flex-1">
          <MapStage
            styleId={styleId}
            world={world}
            preset={preset}
            onReady={(api) => {
              apiRef.current = api;
              setReady(true);
            }}
          />
          {!exporting && (
            <div className="pointer-events-none absolute right-4 top-4 rounded-xl border border-white/10 bg-black/35 px-3.5 py-2 backdrop-blur-md">
              {currentTitle ? (
                <>
                  <div className="text-[12px] font-bold text-white">{currentTitle}</div>
                  <div className="mt-0.5 flex gap-2 text-[10.5px] font-medium text-slate-300/80">
                    <span>{VEHICLE_LABEL[vehicleOverride === "auto" ? "car" : vehicleOverride]}</span>
                    <span>·</span>
                    <span className="capitalize">
                      {preset === "auto" ? "Cinematic Auto" : `${preset} cam`}
                    </span>
                  </div>
                </>
              ) : (
                <div className="text-[11.5px] text-slate-300">3D Journey Visualizer</div>
              )}
            </div>
          )}
        </main>

        <RightPanel
          preset={preset}
          onPreset={setPreset}
          settings={settings}
          onSettings={setSettings}
          onExport={handleExport}
          onCancelExport={() => {
            cancelRef.current = true;
          }}
          exporting={exporting}
          progress={progress}
          downloadUrl={downloadUrl}
          ext={ext}
          canExport={!!currentTitle && !exporting}
        />
      </div>

      <div className="h-[64px] shrink-0">
        <TimelineBar engine={ready ? apiRef.current?.engine ?? null : null} />
      </div>
    </div>
  );
}
