import type { Feature, LineString } from "geojson";
import {
  VEHICLE_DEFAULT_SPEED,
  type CompiledJourney,
  type JourneyEvent,
  type JourneySample,
  type JourneySpec,
  type RawPoint,
  type VehicleKind,
} from "./types";

const EARTH_R = 6371000;

export function haversineDist(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

interface Ctrl {
  x: number;
  y: number;
  lat: number;
  lng: number;
  tMs: number;
  s: number;
  name?: string;
}

function cleanPoints(points: RawPoint[]): { pts: RawPoint[]; hadTimes: boolean } {
  const withTs = points.filter(
    (p) => isFinite(p.lat) && isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
  );
  let hadTimes = true;
  for (const p of withTs) if (!p.timestamp) hadTimes = false;
  const parsed = withTs.map((p) => ({
    ...p,
    _t: p.timestamp ? new Date(p.timestamp).getTime() : NaN,
  }));
  if (hadTimes) parsed.sort((a, b) => (a._t as number) - (b._t as number));
  const out: RawPoint[] = [];
  let last: RawPoint | null = null;
  for (const p of parsed) {
    if (last && haversineDist(last.lat, last.lng, p.lat, p.lng) < 3) continue;
    out.push({ lat: p.lat, lng: p.lng, timestamp: p.timestamp, name: p.name });
    last = p;
  }
  return { pts: out, hadTimes };
}

class CatmullRomPath {
  ctrls: Ctrl[] = [];
  totalMeters = 0;
  private frameLat = 0;
  private mx = 111320;
  private my = 110540;

  build(pts: RawPoint[], timesMs: number[]): [number, number][] {
    this.frameLat = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
    this.my = 110540;
    this.mx = 111320 * Math.cos((this.frameLat * Math.PI) / 180);
    this.ctrls = pts.map((p, i) => ({
      x: p.lng * this.mx,
      y: p.lat * this.my,
      lat: p.lat,
      lng: p.lng,
      tMs: timesMs[i],
      s: 0,
      name: p.name,
    }));
    for (let i = 1; i < this.ctrls.length; i++) {
      this.ctrls[i].s =
        this.ctrls[i - 1].s +
        Math.hypot(this.ctrls[i].x - this.ctrls[i - 1].x, this.ctrls[i].y - this.ctrls[i - 1].y);
    }
    this.totalMeters = this.ctrls[this.ctrls.length - 1].s;
    return [
      [this.ctrls[0].lng, this.ctrls[0].lat],
      [this.ctrls[this.ctrls.length - 1].lng, this.ctrls[this.ctrls.length - 1].lat],
    ];
  }

  private seg(i: number, t: number): [number, number] {
    const n = this.ctrls.length;
    const p0 = this.ctrls[Math.max(0, i - 1)];
    const p1 = this.ctrls[i];
    const p2 = this.ctrls[Math.min(n - 1, i + 1)];
    const p3 = this.ctrls[Math.min(n - 1, i + 2)];
    const t2 = t * t;
    const t3 = t2 * t;
    const mx = (a: number, b: number, c: number, d: number) =>
      0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    return [mx(p0.x, p1.x, p2.x, p3.x), mx(p0.y, p1.y, p2.y, p3.y)];
  }

  sampleAt(s: number): { lat: number; lng: number; i: number; f: number } {
    const cs = this.ctrls;
    if (this.totalMeters <= 0 || s <= 0) return { lat: cs[0].lat, lng: cs[0].lng, i: 0, f: 0 };
    if (s >= this.totalMeters) {
      const l = cs.length - 1;
      return { lat: cs[l].lat, lng: cs[l].lng, i: l - 1, f: 1 };
    }
    let lo = 0;
    let hi = cs.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cs[mid].s <= s) lo = mid;
      else hi = mid;
    }
    const segLen = cs[lo + 1].s - cs[lo].s;
    const f = segLen > 0 ? (s - cs[lo].s) / segLen : 0;
    const [x, y] = this.seg(lo, f);
    return { lat: y / this.my, lng: x / this.mx, i: lo, f };
  }

  timeAt(s: number): number {
    const { i, f } = this.sampleAt(s);
    const a = this.ctrls[i];
    const b = this.ctrls[i + 1] ?? a;
    return a.tMs + (b.tMs - a.tMs) * f;
  }
}

export interface TimeWarp {
  scale: number;
  journeyToPb(tMs: number): number;
}

function buildTimeWarp(ctrls: { tMs: number }[], targetPb: number): TimeWarp {
  const n = ctrls.length;
  const gaps: number[] = [];
  let effective = 0;
  for (let i = 1; i < n; i++) {
    let g = Math.max(0, (ctrls[i].tMs - ctrls[i - 1].tMs) / 1000);
    if (!isFinite(g)) g = 30;
    gaps.push(g);
    effective += g <= 90 ? g : 90 + (g - 90) * 0.02;
  }
  const scale = effective > 0 ? targetPb / effective : 1;
  const cumReal: number[] = [0];
  for (let i = 1; i < n; i++)
    cumReal.push(cumReal[i - 1] + (ctrls[i].tMs - ctrls[i - 1].tMs) / 1000);
  return {
    scale,
    journeyToPb(tMs: number): number {
      if (n < 2) return 0;
      if (tMs <= ctrls[0].tMs) return 0;
      if (tMs >= ctrls[n - 1].tMs) return 0 + effective * scale;
      let lo = 0;
      let hi = n - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (ctrls[mid].tMs <= tMs) lo = mid;
        else hi = mid;
      }
      const span = ctrls[lo + 1].tMs - ctrls[lo].tMs;
      const f = span > 0 ? (tMs - ctrls[lo].tMs) / span : 0;
      const g = gaps[lo];
      const c = g <= 90 ? g : 90 + (g - 90) * 0.02;
      let acc = 0;
      for (let i = 0; i < lo; i++) {
        const gi = gaps[i];
        acc += gi <= 90 ? gi : 90 + (gi - 90) * 0.02;
      }
      return (acc + c * f) * scale;
    },
  };
}

export function detectVehicle(spec: JourneySpec, spanM: number): VehicleKind {
  if (spec.vehicle && spec.vehicle !== ("auto" as VehicleKind)) return spec.vehicle;
  if (spanM > 800000) return "airplane";
  return "car";
}

export function resolveSpecVehicle(spec: JourneySpec): VehicleKind {
  let spanM = 0;
  for (let i = 1; i < spec.points.length; i++)
    spanM += haversineDist(
      spec.points[i - 1].lat,
      spec.points[i - 1].lng,
      spec.points[i].lat,
      spec.points[i].lng
    );
  return detectVehicle(spec, spanM);
}

export function compileJourney(spec: JourneySpec, id = `j-${Date.now()}`): CompiledJourney {
  const { pts } = cleanPoints(spec.points);
  if (pts.length < 2) throw new Error("Need at least 2 distinct GPS points");

  let spanM = 0;
  for (let i = 1; i < pts.length; i++)
    spanM += haversineDist(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);

  const vehicle = detectVehicle(spec, spanM);

  let times: number[];
  const first = pts[0].timestamp ? new Date(pts[0].timestamp).getTime() : NaN;
  if (pts.every((p) => p.timestamp)) {
    times = pts.map((p) => new Date(p.timestamp as string).getTime());
    for (let i = 1; i < times.length; i++)
      if (!(times[i] > times[i - 1])) times[i] = times[i - 1] + 15000;
  } else {
    const base = isFinite(first) ? first : Date.now();
    times = [base];
    for (let i = 1; i < pts.length; i++) {
      const d = haversineDist(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
      const v = VEHICLE_DEFAULT_SPEED[vehicle];
      times.push(times[i - 1] + Math.min(Math.max(d / v, 20), 600) * 1000);
    }
  }

  const path = new CatmullRomPath();
  const roadGeom = spec.roadGeometry;
  let geomPts: RawPoint[];
  let geomTimes: number[];
  if (roadGeom && roadGeom.length >= 2 && vehicle !== "airplane" && vehicle !== "train") {
    const cumRaw: number[] = [0];
    for (let i = 1; i < pts.length; i++)
      cumRaw.push(cumRaw[i - 1] + haversineDist(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng));
    const totalRaw = Math.max(cumRaw[cumRaw.length - 1], 1e-6);

    const mg: [number, number][] = [];
    for (const c of roadGeom) {
      const last = mg[mg.length - 1];
      if (!last || Math.abs(last[0] - c[0]) > 1e-7 || Math.abs(last[1] - c[1]) > 1e-7) mg.push(c);
    }
    const cumM: number[] = [0];
    for (let i = 1; i < mg.length; i++)
      cumM.push(
        cumM[i - 1] + haversineDist(mg[i - 1][1], mg[i - 1][0], mg[i][1], mg[i][0])
      );
    const totalM = Math.max(cumM[cumM.length - 1], 1e-6);

    const timeAtDist = (dMetersFraction: number): number => {
      const target = dMetersFraction * totalRaw;
      let lo = 0;
      let hi = cumRaw.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (cumRaw[mid] <= target) lo = mid;
        else hi = mid;
      }
      const span = cumRaw[hi] - cumRaw[lo];
      const f = span > 0 ? (target - cumRaw[lo]) / span : 0;
      return times[lo] + (times[Math.min(times.length - 1, hi)] - times[lo]) * f;
    };

    geomPts = mg.map(([lng, lat]) => ({ lat, lng }));
    geomTimes = mg.map((_, i) => timeAtDist(cumM[i] / totalM));

    for (let pi = 0; pi < pts.length; pi++) {
      const p = pts[pi];
      if (!p.name) continue;
      const frac = cumRaw[pi] / totalRaw;
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < mg.length; i++) {
        const d = Math.abs(cumM[i] / totalM - frac);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      if (!geomPts[bestI].name || bestD < 0.004) geomPts[bestI].name = p.name;
    }
  } else {
    geomPts = pts;
    geomTimes = times;
  }
  path.build(geomPts, geomTimes);

  let effTotal = 0;
  for (let i = 1; i < path.ctrls.length; i++) {
    const g = Math.max(0, (path.ctrls[i].tMs - path.ctrls[i - 1].tMs) / 1000);
    effTotal += g <= 90 ? g : 90 + (g - 90) * 0.02;
  }
  const targetPb = Math.min(Math.max(effTotal / 12, 60), 200);
  const finalWarp = buildTimeWarp(path.ctrls, targetPb);

  const step = Math.max(25, Math.min(300, path.totalMeters / 900));
  const count = Math.min(1600, Math.max(60, Math.round(path.totalMeters / step)));

  const samples: JourneySample[] = [];
  for (let k = 0; k <= count; k++) {
    const s = (k / count) * path.totalMeters;
    const pos = path.sampleAt(s);
    samples.push({
      lng: pos.lng,
      lat: pos.lat,
      tMs: path.timeAt(s),
      pb: 0,
      dist: s,
      bearing: 0,
      speed: 0,
      elev: 0,
      urban: 0,
      curviness: 0,
    });
  }

  for (let k = 0; k < samples.length; k++) {
    const a = samples[Math.max(0, k - 2)];
    const b = samples[Math.min(samples.length - 1, k + 2)];
    if (haversineDist(a.lat, a.lng, b.lat, b.lng) > 1)
      samples[k].bearing = bearingDeg(a.lat, a.lng, b.lat, b.lng);
    else samples[k].bearing = k > 0 ? samples[k - 1].bearing : 0;
  }
  for (let k = 0; k < samples.length; k++) {
    const i0 = Math.max(0, k - 4);
    const i1 = Math.min(samples.length - 1, k + 4);
    let sum = 0;
    let wsum = 0;
    let prev = samples[i0].bearing;
    for (let i = i0; i <= i1; i++) {
      let d = samples[i].bearing - prev;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      sum += d;
      prev = samples[i].bearing;
    }
    const turnRate = sum / Math.max(1, i1 - i0);
    let cur = samples[k].bearing;
    for (let i = i0; i <= i1; i++) {
      let d = samples[i].bearing - cur;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      cur += d * 0.5;
    }
    samples[k].bearing = ((cur % 360) + 360) % 360;
    samples[k].curviness = Math.min(1, Math.abs(turnRate) / 8);
  }

  const ctrlSpeeds: number[] = [];
  for (let i = 0; i < path.ctrls.length; i++) {
    const a = path.ctrls[i];
    const b = path.ctrls[Math.min(path.ctrls.length - 1, i + 1)];
    const gapS = Math.max(0.5, (b.tMs - a.tMs) / 1000);
    const segM = b.s - a.s;
    ctrlSpeeds.push(b === a ? 0 : segM / gapS);
  }
  for (let k = 0; k < samples.length; k++) {
    let lo = 0;
    let hi = path.ctrls.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (path.ctrls[mid].tMs <= samples[k].tMs) lo = mid;
      else hi = mid - 1;
    }
    samples[k].speed = Math.max(0, isFinite(ctrlSpeeds[lo]) ? ctrlSpeeds[lo] : 0);
  }
  smoothScalar(samples, "speed", 5);

  const win = Math.max(6, Math.round(samples.length / 40));
  for (let k = 0; k < samples.length; k++) {
    const i0 = Math.max(0, k - win);
    const i1 = Math.min(samples.length - 1, k + win);
    let curv = 0;
    let slow = 0;
    for (let i = i0; i <= i1; i++) {
      curv += samples[i].curviness;
      slow += Math.min(1, samples[i].speed / 8);
    }
    const n = i1 - i0 + 1;
    samples[k].urban = Math.min(1, (curv / n) * 1.6 + (1 - slow / n) * 0.7);
  }
  smoothScalar(samples, "urban", 10);

  for (const sm of samples) sm.pb = finalWarp.journeyToPb(sm.tMs);
  for (let k = 1; k < samples.length; k++) if (samples[k].pb <= samples[k - 1].pb) samples[k].pb = samples[k - 1].pb + 0.01;

  const durationPb = samples[samples.length - 1].pb;
  const introDur = Math.min(Math.max(durationPb * 0.07, 4), 8);
  const finaleDur = Math.min(Math.max(durationPb * 0.08, 5), 9);

  const startMs = times[0];
  const endMs = times[times.length - 1];

  const events = buildEvents(spec.title, pts, path, samples, vehicle, introDur, durationPb - finaleDur);

  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const pad = 0.02;
  const bounds: [number, number][] = [
    [Math.min(...lngs) - pad, Math.min(...lats) - pad],
    [Math.max(...lngs) + pad, Math.max(...lats) + pad],
  ];

  const coords = samples.map((s) => [s.lng, s.lat] as [number, number]);

  return {
    id,
    title: spec.title || "Journey",
    vehicle,
    samples,
    totalMeters: path.totalMeters,
    durationPb,
    introDur,
    finaleDur,
    startMs,
    endMs,
    events,
    bounds,
    lineFull: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } },
    isFlight: vehicle === "airplane" || spanM > 900000,
  };
}

function nearestCtrlFrac(path: CatmullRomPath, tMs: number): { i: number; f: number } {
  const cs = path.ctrls;
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < cs.length; i++) {
    const d = Math.abs(cs[i].tMs - tMs);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  return { i: bestI, f: 0.5 };
}

function smoothScalar(samples: JourneySample[], key: "speed" | "urban", passes: number) {
  for (let p = 0; p < passes; p++) {
    let prev = samples[0][key];
    for (let i = 1; i < samples.length - 1; i++) {
      const next = samples[i + 1][key];
      const v = samples[i][key];
      samples[i][key] = prev * 0.25 + v * 0.5 + next * 0.25;
      prev = v;
    }
  }
}

function buildEvents(
  title: string,
  pts: RawPoint[],
  path: CatmullRomPath,
  samples: JourneySample[],
  vehicle: VehicleKind,
  introDur: number,
  mainEndPb: number
): JourneyEvent[] {
  const events: JourneyEvent[] = [];
  const startName = pts.find((p) => p.name)?.name ?? "";
  events.push({
    pb: introDur,
    kind: "start",
    title: formatHm(path.ctrls[0].tMs),
    subtitle: startName || "Starting Journey",
    name: startName,
  });
  events.push({
    pb: mainEndPb + 0.5,
    kind: "arrival",
    title: formatHm(path.ctrls[path.ctrls.length - 1].tMs),
    subtitle: pts[pts.length - 1]?.name ? `${pts[pts.length - 1].name} · Arrived` : "Destination",
    name: pts[pts.length - 1]?.name,
  });

  for (let i = 1; i < path.ctrls.length - 1; i++) {
    const c = path.ctrls[i];
    if (!c.name) continue;
    events.push({
      pb: clampPb(samples, findPbIndex(samples, c.tMs)),
      kind: "city",
      title: formatHm(c.tMs),
      subtitle: c.name,
      name: c.name,
    });
  }

  const rawTimes: number[] = [];
  for (const p of pts) {
    const t = p.timestamp ? new Date(p.timestamp).getTime() : NaN;
    if (isFinite(t)) rawTimes.push(t);
  }
  rawTimes.sort((a, b) => a - b);
  const totalSpanMin = rawTimes.length >= 2 ? (rawTimes[rawTimes.length - 1] - rawTimes[0]) / 60000 : 0;
  const stopThresholdMin = (() => {
    const gaps: number[] = [];
    for (let i = 1; i < rawTimes.length; i++)
      gaps.push((rawTimes[i] - rawTimes[i - 1]) / 60000);
    gaps.sort((a, b) => a - b);
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 5;
    return Math.max(9, Math.min(25, median * 5));
  })();
  if (rawTimes.length >= 3) {
    for (let i = 0; i < pts.length - 1; i++) {
      const ta = pts[i].timestamp ? new Date(pts[i].timestamp as string).getTime() : NaN;
      const tb = pts[i + 1].timestamp ? new Date(pts[i + 1].timestamp as string).getTime() : NaN;
      if (!isFinite(ta) || !isFinite(tb)) continue;
      const gap = (tb - ta) / 60000;
      if (gap >= stopThresholdMin && gap < totalSpanMin * 0.6 && gap < 24 * 60) {
        events.push({
          pb: clampPb(samples, findPbIndex(samples, ta)),
          kind: "stop",
          title: formatHm(ta),
          subtitle: `Stop · ${Math.round(gap)} min`,
        });
      }
    }
  }

  if (vehicle === "airplane") {
    events.unshift({ pb: introDur + 1, kind: "takeoff", title: "", subtitle: "Takeoff" });
    events.push({ pb: mainEndPb - 1, kind: "landing", title: "", subtitle: "Final Approach" });
  }
  events.sort((a, b) => a.pb - b.pb);
  return events;
}

function findPbIndex(samples: JourneySample[], tMs: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const d = Math.abs(samples[i].tMs - tMs);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return samples[best].pb;
}

function clampPb(samples: JourneySample[], pb: number): number {
  const max = samples[samples.length - 1].pb;
  return Math.min(Math.max(pb, 0), max);
}

function formatHm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
