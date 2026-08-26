import type { VehicleKind } from "./types";

type LngLat = [number, number];

const ENDPOINTS = [
  "https://routing.openstreetmap.de",
  "https://router.project-osrm.org",
];

function profileFor(vehicle: VehicleKind): "routed-car" | "routed-bike" | "routed-foot" {
  switch (vehicle) {
    case "bicycle":
      return "routed-bike";
    case "walking":
      return "routed-foot";
    default:
      return "routed-car";
  }
}

function shouldMatch(vehicle: VehicleKind): boolean {
  return (
    vehicle === "car" ||
    vehicle === "motorcycle" ||
    vehicle === "bus" ||
    vehicle === "bicycle" ||
    vehicle === "walking"
  );
}

function dedupe(coords: LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const c of coords) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - c[0]) > 1e-7 || Math.abs(last[1] - c[1]) > 1e-7) {
      out.push(c);
    }
  }
  return out;
}

async function fetchRoute(coords: LngLat[], profile: string, signal: AbortSignal): Promise<LngLat[] | null> {
  const coordStr = coords.map((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(";");
  for (const base of ENDPOINTS) {
    const url = `${base}/${profile}/route/v1/driving/${coordStr}?overview=full&geometries=geojson&continue_straight=true`;
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        code?: string;
        routes?: { geometry?: { coordinates?: LngLat[] } }[];
      };
      if (json.code !== "Ok" || !json.routes?.[0]?.geometry?.coordinates) continue;
      const g = dedupe(json.routes[0].geometry.coordinates);
      if (g.length >= 2) return g;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      continue;
    }
  }
  return null;
}

export interface MatchResult {
  coords: LngLat[];
  matched: boolean;
}

export async function snapToRoads(
  points: { lat: number; lng: number }[],
  vehicle: VehicleKind,
  signal: AbortSignal = new AbortController().signal
): Promise<MatchResult> {
  const clean = dedupe(points.map((p) => [p.lng, p.lat] as LngLat));
  if (clean.length < 2 || !shouldMatch(vehicle)) {
    return { coords: clean, matched: false };
  }
  const profile = profileFor(vehicle);
  const CHUNK = 60;
  if (clean.length <= CHUNK) {
    const r = await fetchRoute(clean, profile, signal);
    return { coords: r ?? clean, matched: !!r };
  }
  const chunks: LngLat[][] = [];
  for (let i = 0; i < clean.length; i += CHUNK - 1) {
    chunks.push(clean.slice(i, Math.min(clean.length, i + CHUNK)));
  }
  const out: LngLat[] = [];
  for (const ch of chunks) {
    if (ch.length < 2) continue;
    const r = await fetchRoute(ch, profile, signal);
    if (!r) return { coords: clean, matched: false };
    for (const c of r) {
      const last = out[out.length - 1];
      if (!last || last[0] !== c[0] || last[1] !== c[1]) out.push(c);
    }
    if (chunks.length > 3) await new Promise((res) => setTimeout(res, 250));
  }
  return out.length >= 2 ? { coords: out, matched: true } : { coords: clean, matched: false };
}
