import type { CameraPreset } from "../journey/types";
import { clamp } from "./easing";

export function baseZoomForSpeed(speedMs: number): number {
  const kmh = speedMs * 3.6;
  if (kmh <= 8) return 17.6;
  if (kmh <= 30) return 16.85;
  if (kmh <= 60) return 16.15;
  if (kmh <= 95) return 15.5;
  if (kmh <= 140) return 14.85;
  return 14.1;
}

export interface ContextSignals {
  speedMs: number;
  urban: number;
  slope: number;
  curviness: number;
}

export function smartZoom(preset: CameraPreset, s: ContextSignals): number {
  let z = baseZoomForSpeed(s.speedMs);
  if (s.urban > 0.55) z += 0.3;
  if (s.slope > 0.05) z -= Math.min(0.5, s.slope * 2.2);
  if (preset === "drone") z -= 2.3;
  if (preset === "top") z -= 0.7;
  if (preset === "side") z -= 0.25;
  if (preset === "orbit") z -= 0.45;
  return z;
}

export function pitchFor(preset: CameraPreset, urban: number, slope: number): number {
  switch (preset) {
    case "drone":
      return 56;
    case "top":
      return 8;
    case "side":
      return 64;
    case "orbit":
      return 62;
    case "chase":
      break;
    default:
      break;
  }
  let p = 62;
  if (urban > 0.55) p = 57;
  if (slope > 0.06) p = 69;
  return p;
}

export const FOLLOW_LAMBDA: Record<CameraPreset, { bearing: number; center: number; zoom: number; pitch: number }> = {
  auto: { bearing: 2.4, center: 3.4, zoom: 2.6, pitch: 3.0 },
  chase: { bearing: 2.2, center: 3.6, zoom: 2.4, pitch: 3.0 },
  drone: { bearing: 1.4, center: 2.2, zoom: 2.0, pitch: 2.4 },
  side: { bearing: 2.6, center: 3.2, zoom: 2.6, pitch: 3.0 },
  top: { bearing: 1.8, center: 4.0, zoom: 2.8, pitch: 3.4 },
  orbit: { bearing: 99, center: 4.0, zoom: 2.8, pitch: 3.0 },
};

export function leadMeters(preset: CameraPreset, speedMs: number): number {
  const base = clamp(speedMs * 2.4, 18, 320);
  if (preset === "drone") return base * 1.7;
  if (preset === "side") return base * 0.35;
  if (preset === "top") return base * 0.6;
  return base;
}

export function metersToDegLat(m: number): number {
  return m / 110540;
}

export function metersToDegLng(m: number, lat: number): number {
  return m / (111320 * Math.max(0.15, Math.cos((lat * Math.PI) / 180)));
}
