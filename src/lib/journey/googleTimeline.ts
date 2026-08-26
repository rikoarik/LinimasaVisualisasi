import type { RawPoint, TripOption, VehicleKind } from "./types";

const ACTIVITY_VEHICLE: Record<string, VehicleKind> = {
  IN_PASSENGER_VEHICLE: "car",
  IN_ROAD_VEHICLE: "car",
  IN_VEHICLE: "car",
  MOTORCYCLING: "motorcycle",
  ON_BICYCLE: "bicycle",
  WALKING: "walking",
  ON_FOOT: "walking",
  RUNNING: "walking",
  HIKING: "walking",
  IN_RAIL_VEHICLE: "train",
  IN_TRAM: "train",
  IN_BUS: "bus",
  FLYING: "airplane",
  IN_AIRCRAFT: "airplane",
};

interface LatLng {
  lat: number;
  lng: number;
}

function parseLatLng(raw: unknown): LatLng | null {
  if (!raw || typeof raw !== "string") return null;
  const m = raw.match(/(-?\d+(?:\.\d+)?)\s*°\s*,\s*(-?\d+(?:\.\d+)?)\s*°?/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  return { lat, lng };
}

function parseTime(raw: unknown): number {
  if (typeof raw !== "string") return NaN;
  return new Date(raw).getTime();
}

interface MovementUnit {
  tStart: number;
  tEnd: number;
  pts: RawPoint[];
  vehicles: string[];
}

function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function dominantVehicle(units: MovementUnit[]): VehicleKind {
  const counts = new Map<VehicleKind, number>();
  for (const u of units)
    for (const v of u.vehicles) counts.set(v as VehicleKind, (counts.get(v as VehicleKind) ?? 0) + 1);
  let best: VehicleKind = "car";
  let bestN = -1;
  const priority: VehicleKind[] = [
    "airplane",
    "train",
    "motorcycle",
    "bicycle",
    "bus",
    "car",
    "walking",
  ];
  for (const [v, n] of counts) {
    const score = n * 1000 - priority.indexOf(v);
    if (n >= 1 && score > bestN) {
      bestN = score;
      best = v;
    }
  }
  return best;
}

function titleFor(startMs: number, endMs: number): string {
  const d = new Date(startMs);
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const t0 = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const d2 = new Date(endMs);
  const t1 = `${String(d2.getHours()).padStart(2, "0")}:${String(d2.getMinutes()).padStart(2, "0")}`;
  return `${day} · ${t0}–${t1}`;
}

function thin(points: RawPoint[], max: number): RawPoint[] {
  if (points.length <= max) return points;
  const out: RawPoint[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

export interface GoogleTimelineSummary {
  trips: TripOption[];
  totalSegments: number;
}

export function extractGoogleTimelineTrips(data: unknown): GoogleTimelineSummary {
  const result: TripOption[] = [];
  const anyData = data as { semanticSegments?: unknown[] };
  const segments = Array.isArray(anyData?.semanticSegments)
    ? anyData.semanticSegments
    : [];
  const units: MovementUnit[] = [];

  for (const seg of segments as Record<string, never>[]) {
    const s = seg as unknown as Record<string, any>;
    const st = parseTime(s?.startTime);
    const en = parseTime(s?.endTime);

    if (Array.isArray(s?.timelinePath) && s.timelinePath.length > 0) {
      const pts: RawPoint[] = [];
      for (const tp of s.timelinePath) {
        const ll = parseLatLng(tp?.point);
        const t = parseTime(tp?.time);
        if (ll) pts.push({ lat: ll.lat, lng: ll.lng, timestamp: isNaN(t) ? undefined : new Date(t).toISOString() });
      }
      if (pts.length >= 2) units.push({ tStart: isNaN(st) ? 0 : st, tEnd: isNaN(en) ? 0 : en, pts, vehicles: [] });
      continue;
    }

    if (s?.activity) {
      const act = s.activity;
      const type = String(act?.topCandidate?.type ?? "");
      const veh = ACTIVITY_VEHICLE[type];
      const pts: RawPoint[] = [];
      const a = parseLatLng(act?.start?.latLng);
      const b = parseLatLng(act?.end?.latLng);
      if (a) pts.push({ lat: a.lat, lng: a.lng, timestamp: isNaN(st) ? undefined : new Date(st).toISOString() });
      if (b) pts.push({ lat: b.lat, lng: b.lng, timestamp: isNaN(en) ? undefined : new Date(en).toISOString() });
      if (pts.length >= 2 && veh && !isNaN(st) && !isNaN(en)) {
        units.push({ tStart: st, tEnd: en, pts, vehicles: [veh] });
      }
    }
  }

  units.sort((a, b) => a.tStart - b.tStart);

  const MERGE_GAP_MS = 20 * 60 * 1000;
  let cluster: MovementUnit[] = [];
  const flush = () => {
    if (!cluster.length) return;
    const pts: RawPoint[] = [];
    for (const u of cluster) for (const p of u.pts) pts.push(p);
    const thinned = thin(pts, 1400);
    let dist = 0;
    for (let i = 1; i < thinned.length; i++)
      dist += haversine(thinned[i - 1], thinned[i]);
    const first = cluster[0];
    const last = cluster[cluster.length - 1];
    if (thinned.length >= 2 && dist > 250) {
      result.push({
        id: `gt-${result.length}`,
        title: titleFor(first.tStart, last.tEnd),
        vehicle: dominantVehicle(cluster),
        points: thinned,
        distanceKm: dist / 1000,
        startMs: first.tStart,
        endMs: last.tEnd,
      });
    }
    cluster = [];
  };

  let prevEnd = -Infinity;
  for (const u of units) {
    if (cluster.length && (u.tStart - prevEnd > MERGE_GAP_MS || u.tStart < prevEnd)) flush();
    cluster.push(u);
    prevEnd = Math.max(prevEnd, u.tEnd || u.tStart);
  }
  flush();

  result.sort((a, b) => b.distanceKm - a.distanceKm);
  return { trips: result.slice(0, 60), totalSegments: segments.length };
}
