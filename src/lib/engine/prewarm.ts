import type { Map as MlMap } from "maplibre-gl";
import type { CompiledJourney } from "../journey/types";
import type { JourneyEngine } from "./JourneyEngine";

export function awaitMapIdle(map: MlMap, capMs = 2500): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      map.off("idle", handler);
      clearTimeout(timer);
      resolve();
    };
    const handler = () => finish();
    const timer = setTimeout(finish, capMs);
    map.once("idle", handler);
    map.triggerRepaint();
  });
}

export interface PrewarmOptions {
  map: MlMap;
  engine: JourneyEngine;
  journey: CompiledJourney;
  steps?: number;
  onProgress?: (pct: number) => void;
}

export async function prewarmRoute(opts: PrewarmOptions): Promise<boolean> {
  const { map, engine, journey, onProgress } = opts;
  const steps = opts.steps ?? Math.min(90, Math.max(30, Math.round(journey.durationPb / 2.5)));
  const yieldMs = 25;

  const sweep = async (total: number, reportFrom: number, reportTo: number) => {
    for (let i = 0; i <= total; i++) {
      if (engine.playing) return false;
      const t = (i / total) * journey.durationPb;
      const { idx } = engine.sampleAt(t);
      const sample = journey.samples[idx];
      engine.director.update(sample, idx, t, 0.016, true);
      const cam = engine.director.getCamera();
      map.jumpTo({
        center: [cam.lng, cam.lat],
        zoom: cam.zoom,
        pitch: cam.pitch,
        bearing: cam.bearing,
      });
      const pct = reportFrom + ((i / total) * (reportTo - reportTo * 0.35 - reportFrom));
      onProgress?.(Math.min(reportTo - 1, Math.round(pct)));
      if (i % 2 === 1) await new Promise((r) => setTimeout(r, yieldMs));
    }
    return true;
  };

  const ok = await sweep(steps, 0, 65);
  if (!ok) return false;
  onProgress?.(70);
  await awaitMapIdle(map, 6000);

  if (engine.playing) return false;
  await sweep(Math.min(24, steps), 70, 95);
  onProgress?.(97);
  await awaitMapIdle(map, 4000);
  onProgress?.(100);
  return true;
}
