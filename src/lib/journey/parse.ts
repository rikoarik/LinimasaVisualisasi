import { extractGoogleTimelineTrips } from "./googleTimeline";
import { haversineDist } from "./resample";
import {
  VEHICLE_KINDS,
  type JourneySpec,
  type ParseResult,
  type RawPoint,
  type TripOption,
  type VehicleKind,
} from "./types";

function coerceVehicle(v: unknown): VehicleKind | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.toLowerCase().trim();
  if (s === "auto") return undefined;
  return VEHICLE_KINDS.find((k) => k === s);
}

function parseSimple(data: Record<string, unknown>): ParseResult | null {
  const rawPoints = data.points;
  if (!Array.isArray(rawPoints) || rawPoints.length < 2) return null;
  const points: RawPoint[] = [];
  for (const rp of rawPoints as Record<string, unknown>[]) {
    const lat = typeof rp.lat === "number" ? rp.lat : parseFloat(String(rp.lat));
    const lng = typeof rp.lng === "number" ? rp.lng : parseFloat(String(rp.lng));
    if (!isFinite(lat) || !isFinite(lng)) continue;
    points.push({
      lat,
      lng,
      timestamp: typeof rp.timestamp === "string" ? rp.timestamp : undefined,
      name: typeof rp.name === "string" ? rp.name : undefined,
    });
  }
  if (points.length < 2) return null;
  return {
    kind: "simple",
    journeys: [
      {
        title: typeof data.title === "string" && data.title.trim() ? data.title.trim() : "Custom Journey",
        vehicle: coerceVehicle(data.vehicle),
        points,
      },
    ],
    trips: [],
  };
}

function parseGeojson(data: Record<string, unknown>): ParseResult | null {
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) return null;
  const journeys: JourneySpec[] = [];
  for (const f of data.features as Record<string, any>[]) {
    const geom = f?.geometry;
    if (!geom || (geom.type !== "LineString" && geom.type !== "MultiLineString")) continue;
    const lines: number[][][] =
      geom.type === "LineString" ? [geom.coordinates] : geom.coordinates;
    for (const coords of lines) {
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const times = (props.coordTimes ?? propertiesTimes(props)) as unknown[] | undefined;
      const points: RawPoint[] = coords.map((c, i) => ({
        lat: c[1],
        lng: c[0],
        timestamp: times && typeof times[i] === "string" ? (times[i] as string) : undefined,
        name: typeof props.name === "string" ? props.name : undefined,
      }));
      journeys.push({
        title: typeof props.name === "string" ? props.name : `Route ${journeys.length + 1}`,
        vehicle: coerceVehicle(props.vehicle),
        points,
      });
    }
  }
  if (!journeys.length) return null;
  return { kind: "geojson", journeys, trips: [] };
}

function propertiesTimes(props: Record<string, unknown>): unknown[] | undefined {
  const t = props.times ?? props.timestamps;
  return Array.isArray(t) ? t : undefined;
}

function parseGoogleTimeline(data: Record<string, unknown>): ParseResult {
  const { trips } = extractGoogleTimelineTrips(data);
  if (!trips.length) {
    return {
      kind: "google-timeline",
      journeys: [],
      trips: [],
      message:
        "Google Timeline detected but no usable trips with movement were found in this export.",
    };
  }
  const journeys: JourneySpec[] = [];
  return { kind: "google-timeline", journeys, trips };
}

function estimateTripDistanceKm(points: RawPoint[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++)
    d += haversineDist(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  return d / 1000;
}

export function tripToSpec(trip: TripOption): JourneySpec {
  return {
    title: trip.title,
    vehicle: trip.vehicle,
    points: trip.points.map((p) => ({ ...p })),
  };
}

export function parseJourneyInput(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { kind: "unknown", journeys: [], trips: [], message: "Invalid JSON — could not parse input." };
  }
  if (!data || typeof data !== "object") {
    return { kind: "unknown", journeys: [], trips: [], message: "JSON must be an object." };
  }

  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.semanticSegments)) {
    return parseGoogleTimeline(obj);
  }
  const simple = parseSimple(obj);
  if (simple) return simple;
  const geo = parseGeojson(obj);
  if (geo) return geo;

  return {
    kind: "unknown",
    journeys: [],
    trips: [],
    message:
      'Unrecognized format. Expected {"title","vehicle","points":[{"lat","lng","timestamp"}]}, a Google Timeline export (semanticSegments), or a GeoJSON LineString.',
  };
}

export function summarizeTrip(trip: TripOption): string {
  return `${trip.distanceKm.toFixed(1)} km · ${trip.points.length} pts`;
}

export { estimateTripDistanceKm };
