import type { Feature, LineString } from "geojson";

export type VehicleKind =
  | "car"
  | "motorcycle"
  | "bicycle"
  | "walking"
  | "bus"
  | "train"
  | "airplane";

export const VEHICLE_KINDS: VehicleKind[] = [
  "car",
  "motorcycle",
  "bicycle",
  "walking",
  "bus",
  "train",
  "airplane",
];

export interface RawPoint {
  lat: number;
  lng: number;
  timestamp?: string;
  name?: string;
}

export interface JourneySpec {
  title: string;
  vehicle?: VehicleKind;
  points: RawPoint[];
}

export type CameraPreset =
  | "auto"
  | "chase"
  | "drone"
  | "side"
  | "top"
  | "orbit";

export const CAMERA_PRESETS: CameraPreset[] = [
  "auto",
  "chase",
  "drone",
  "side",
  "top",
  "orbit",
];

export type MapStyleId =
  | "cinematic"
  | "light"
  | "dark"
  | "minimal"
  | "bright"
  | "satellite";

export type EventKind =
  | "start"
  | "stop"
  | "city"
  | "mode"
  | "arrival"
  | "takeoff"
  | "landing";

export interface JourneyEvent {
  pb: number;
  kind: EventKind;
  title: string;
  subtitle: string;
  name?: string;
}

export interface JourneySample {
  lng: number;
  lat: number;
  tMs: number;
  pb: number;
  dist: number;
  bearing: number;
  speed: number;
  elev: number;
  urban: number;
  curviness: number;
}

export interface CompiledJourney {
  id: string;
  title: string;
  vehicle: VehicleKind;
  samples: JourneySample[];
  totalMeters: number;
  durationPb: number;
  introDur: number;
  finaleDur: number;
  startMs: number;
  endMs: number;
  events: JourneyEvent[];
  bounds: [number, number][];
  lineFull: Feature<LineString>;
  isFlight: boolean;
}

export interface TripOption {
  id: string;
  title: string;
  vehicle: VehicleKind;
  points: RawPoint[];
  distanceKm: number;
  startMs: number;
  endMs: number;
}

export interface ParseResult {
  kind: "simple" | "google-timeline" | "geojson" | "unknown";
  journeys: JourneySpec[];
  trips: TripOption[];
  message?: string;
}

export interface WorldOptions {
  style: MapStyleId;
  terrain: boolean;
  buildings: boolean;
  labels: boolean;
  trail: boolean;
}

export const VEHICLE_LABEL: Record<VehicleKind, string> = {
  car: "Car",
  motorcycle: "Motorcycle",
  bicycle: "Bicycle",
  walking: "Walking",
  bus: "Bus",
  train: "Train",
  airplane: "Airplane",
};

export const VEHICLE_DEFAULT_SPEED: Record<VehicleKind, number> = {
  car: 12,
  motorcycle: 11,
  bicycle: 4.5,
  walking: 1.4,
  bus: 9,
  train: 22,
  airplane: 220,
};

export function formatClock(ms: number): string {
  if (!isFinite(ms)) return "--:--";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
