"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MapStage, { type StageApi, type WorldToggles } from "./MapStage";
import TimelineBar from "./TimelineBar";
import LeftPanel from "./panels/LeftPanel";
import RightPanel from "./panels/RightPanel";
import {
  compileJourney,
  resolveSpecVehicle,
} from "@/lib/journey/resample";
import { snapToRoads } from "@/lib/journey/mapMatch";
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
import { prewarmRoute } from "@/lib/engine/prewarm";

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
  const [followRoads, setFollowRoads] = useState(true);
  const [currentTitle, setCurrentTitle] = useState<string | null>(null);
  const [currentVehicle, setCurrentVehicle] = useState<VehicleKind | null>(null);
  const [settings, setSettings] = useState<ExportSettings>({
    aspect: "16:9",
    resolution: 1080,
    fps: 30,
    overlays: true,
    letterbox: true,
  });
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [ext, setExt] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const matchAbort = useRef<AbortController | null>(null);
  const lastSpecRef = useRef<JourneySpec | null>(null);
  const lastTripIdRef = useRef<string | null>(null);
  const geomCache = useRef(new Map<string, [number, number][]>());
  const prefetching = useRef(new Set<string>());
  const [queueInfo, setQueueInfo] = useState<{ index: number; total: number } | null>(null);
  const queueRef = useRef<TripOption[] | null>(null);
  const advanceRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!ready) return;
    const engine = apiRef.current?.engine;
    if (!engine) return;
    engine.onEnded = () => advanceRef.current();
    (window as never as Record<string, unknown>).__jvEngine = engine;
    return () => {
      engine.onEnded = null;
    };
  }, [ready]);

  const prefetchTrip = useCallback(
    (list: TripOption[], index: number) => {
      const next = list[index + 1];
      if (!next || !followRoads) return;
      if (geomCache.current.has(next.id) || prefetching.current.has(next.id)) return;
      prefetching.current.add(next.id);
      const spec = tripToSpec(next);
      snapToRoads(spec.points, resolveSpecVehicle(spec))
        .then((m) => geomCache.current.set(next.id, m.coords))
        .catch(() => {})
        .finally(() => prefetching.current.delete(next.id));
    },
    [followRoads]
  );

  const loadSpec = useCallback(
    async (inputSpec: JourneySpec, tripId: string | null, ctx?: { list: TripOption[]; index: number }) => {
      const api = apiRef.current;
      if (!api) return;
      lastSpecRef.current = inputSpec;
      lastTripIdRef.current = tripId;
      setParseMsg(null);
      setDownloadUrl(null);
      try {
        const spec: JourneySpec = {
          ...inputSpec,
          vehicle:
            vehicleOverride !== "auto"
              ? vehicleOverride
              : (inputSpec.vehicle as VehicleKind | undefined),
        };

        if (followRoads && !spec.roadGeometry && tripId && geomCache.current.has(tripId)) {
          spec.roadGeometry = geomCache.current.get(tripId);
        }

        if (followRoads && !spec.roadGeometry) {
          const veh = resolveSpecVehicle(spec);
          if (veh !== "airplane" && veh !== "train") {
            setParseMsg("Matching route to real roads…");
            matchAbort.current?.abort();
            const ctrl = new AbortController();
            matchAbort.current = ctrl;
            try {
              const m = await snapToRoads(spec.points, veh, ctrl.signal);
              spec.roadGeometry = m.coords;
              if (tripId) geomCache.current.set(tripId, m.coords);
            } catch (e) {
              if ((e as Error)?.name === "AbortError") return;
            }
            if (matchAbort.current !== ctrl) return;
          }
        }

        const journey: CompiledJourney = compileJourney(spec);
        api.loadJourney(journey, world.trail);
        setCurrentTitle(journey.title);
        setCurrentVehicle(journey.vehicle);
        setActiveTripId(tripId);
        setParseMsg(null);
        if (ctx) {
          queueRef.current = ctx.list;
          setQueueInfo({ index: ctx.index, total: ctx.list.length });
        } else {
          queueRef.current = null;
          setQueueInfo(null);
        }
        if (ctx) prefetchTrip(ctx.list, ctx.index);

        setParseMsg("Preparing map… 0%");
        const completed = await prewarmRoute({
          map: api.map,
          engine: api.engine,
          journey,
          onProgress: (pct) => setParseMsg(`Preparing map… ${pct}%`),
        });
        api.engine.director.reset(journey);
        api.engine.seek(0);
        setParseMsg(null);
        setTimeout(() => {
          api.engine.applyFrame(true);
          if (completed || !api.engine.playing) api.engine.play();
        }, 150);
      } catch (e) {
        setParseMsg(e instanceof Error ? e.message : String(e));
      }
    },
    [vehicleOverride, world.trail, followRoads, prefetchTrip]
  );

  const handleTimelineTrips = useCallback(
    (res: ReturnType<typeof parseJourneyInput>) => {
      setTrips(res.trips);
      loadSpec(tripToSpec(res.trips[0]), res.trips[0].id);
    },
    [loadSpec]
  );

  const debugLoad = useCallback(
    (text: string) => {
      const res = parseJourneyInput(text);
      if (res.trips.length > 0) {
        handleTimelineTrips(res);
        return res.trips.length;
      }
      if (res.journeys.length > 0) {
        loadSpec(res.journeys[0], null);
        return 1;
      }
      throw new Error(res.message ?? "parse failed");
    },
    [loadSpec, handleTimelineTrips]
  );

  useEffect(() => {
    (window as never as Record<string, unknown>).__jvDebugLoad = debugLoad;
  }, [debugLoad]);

  useEffect(() => {
    const api = apiRef.current;
    const journey = api?.engine.journey;
    const lastSpec = lastSpecRef.current;
    if (!api || !journey || !lastSpec) return;

    const effective =
      vehicleOverride !== "auto"
        ? vehicleOverride
        : (lastSpec.vehicle as VehicleKind | undefined) ?? journey.vehicle;
    if (effective === journey.vehicle) return;

    const flightSwitch =
      (effective === "airplane" || effective === "train") !==
      (journey.vehicle === "airplane" || journey.vehicle === "train");

    if (flightSwitch || effective === "airplane" || journey.vehicle === "airplane") {
      loadSpec(lastSpec, lastTripIdRef.current, queueRef.current
        ? { list: queueRef.current, index: queueInfo?.index ?? 0 }
        : undefined);
    } else {
      journey.vehicle = effective;
      api.setVehicle(effective);
      setCurrentVehicle(effective);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleOverride]);

  const handleJsonText = useCallback(() => {
    const res = parseJourneyInput(jsonText);
    if (res.trips.length > 0) {
      handleTimelineTrips(res);
      return;
    }
    if (res.journeys.length > 0) {
      loadSpec(res.journeys[0], null);
      return;
    }
    setParseMsg(res.message ?? "Could not read journey JSON.");
  }, [jsonText, loadSpec, handleTimelineTrips]);

  const handleFile = useCallback(
    async (file: File) => {
      setParseMsg(`Reading ${file.name} (${(file.size / 1e6).toFixed(1)} MB)…`);
      try {
        const text = await file.text();
        setJsonText(text.length < 400_000 ? text : "");
        const res = parseJourneyInput(text);
        if (res.trips.length > 0) {
          handleTimelineTrips(res);
        } else if (res.journeys.length > 0) {
          loadSpec(res.journeys[0], null);
        } else {
          setParseMsg(res.message ?? "Could not read file.");
        }
      } catch (e) {
        setParseMsg(`Failed reading file: ${e instanceof Error ? e.message : e}`);
      }
    },
    [loadSpec, handleTimelineTrips]
  );

  const playAll = useCallback(() => {
    if (!trips.length) return;
    loadSpec(tripToSpec(trips[0]), trips[0].id, { list: trips, index: 0 });
  }, [trips, loadSpec]);

  useEffect(() => {
    advanceRef.current = () => {
      const list = queueRef.current;
      if (!list || !queueInfo) return;
      const nextIdx = queueInfo.index + 1;
      if (nextIdx >= list.length) {
        queueRef.current = null;
        setQueueInfo(null);
        return;
      }
      const next = list[nextIdx];
      loadSpec(tripToSpec(next), next.id, { list, index: nextIdx });
    };
  }, [queueInfo, loadSpec]);

  const handleExport = useCallback(async () => {    const api = apiRef.current;
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
      apiRef.current?.engine.pause();
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
          onPlayAll={playAll}
          queueInfo={queueInfo}
          onSkipQueue={() => advanceRef.current()}
          parseMsg={parseMsg}
          vehicleOverride={vehicleOverride}
          onVehicleOverride={setVehicleOverride}
          followRoads={followRoads}
          onFollowRoads={setFollowRoads}
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
                    <span>{VEHICLE_LABEL[currentVehicle ?? "car"]}</span>
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
