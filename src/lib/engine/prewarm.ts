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
  const steps = opts.steps ?? Math.min(140, Math.max(40, Math.round(journey.durationPb / 2)));

  for (let i = 0; i <= steps; i++) {
    if (engine.playing) return false;
    const t = (i / steps) * journey.durationPb;
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
    await awaitMapIdle(map, 2200);
    onProgress?.(Math.round((i / steps) * 100));
    if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return true;
}
