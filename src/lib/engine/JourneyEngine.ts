import type { Map as MlMap } from "maplibre-gl";
import type { CompiledJourney, JourneyEvent, JourneySample } from "../journey/types";
import { Director } from "../cinematic/director";
import { angleDiff, clamp } from "../cinematic/easing";

export interface HudSnapshot {
  time: number;
  duration: number;
  playing: boolean;
  rate: number;
  clockMs: number;
  distanceKm: number;
  totalKm: number;
  speedKmh: number;
  altitudeM: number;
  remainingKm: number;
  progressPct: number;
  currentPlace: string;
  activeEvents: (JourneyEvent & { remain?: number })[];
  hasJourney: boolean;
  title: string;
}

export interface FrameInfo {
  sample: JourneySample;
  idx: number;
  bankDeg: number;
}

const EMPTY_SNAPSHOT: HudSnapshot = {
  time: 0,
  duration: 0,
  playing: false,
  rate: 1,
  clockMs: NaN,
  distanceKm: 0,
  totalKm: 0,
  speedKmh: 0,
  altitudeM: 0,
  remainingKm: 0,
  progressPct: 0,
  currentPlace: "",
  activeEvents: [],
  hasJourney: false,
  title: "",
};

export class JourneyEngine {
  map: MlMap | null = null;
  director = new Director();
  journey: CompiledJourney | null = null;

  time = 0;
  playing = false;
  rate = 1;

  private raf = 0;
  private lastTs = 0;
  private lastIdx = -1;
  private prevBearing = 0;
  private bankSmoothed = 0;
  private elevCache = new Map<string, number>();
  private listeners = new Set<() => void>();
  private snapshot: HudSnapshot = EMPTY_SNAPSHOT;
  private lastNotify = 0;
  private frameCb: ((info: FrameInfo) => void) | null = null;

  setFrameCallback(cb: ((info: FrameInfo) => void) | null) {
    this.frameCb = cb;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getHud(): HudSnapshot {
    return this.snapshot;
  }

  load(journey: CompiledJourney) {
    this.journey = journey;
    this.time = 0;
    this.playing = false;
    this.lastIdx = -1;
    this.bankSmoothed = 0;
    this.director.reset(journey);
    const first = journey.samples[0];
    this.director.snapTo(this.director.getCamera());
    this.applyFrame(true);
    this.snapshot = this.buildSnapshot(first, 0, 0);
    this.notify(true);
  }

  play() {
    if (!this.journey) return;
    if (this.time >= this.journey.durationPb - 0.01) this.time = 0;
    this.playing = true;
    this.startLoop();
    this.notify(true);
  }

  pause() {
    this.playing = false;
    this.notify(true);
  }

  restart() {
    this.seek(0);
    this.play();
  }

  seek(pb: number) {
    if (!this.journey) return;
    this.time = clamp(pb, 0, this.journey.durationPb);
    this.applyFrame(true);
    this.notify(true);
  }

  setRate(r: number) {
    this.rate = r;
    this.notify(true);
  }

  startLoop() {
    if (this.raf) return;
    this.lastTs = performance.now();
    const tick = (ts: number) => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, Math.max(0.001, (ts - this.lastTs) / 1000));
      this.lastTs = ts;
      if (this.playing && this.journey) {
        this.time += dt * this.rate;
        if (this.time >= this.journey.durationPb) {
          this.time = this.journey.durationPb;
          this.playing = false;
          this.notify(true);
        }
        this.applyFrame(false);
        this.notify(false);
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  applyFrame(instant: boolean) {
    const j = this.journey;
    const map = this.map;
    if (!j || !map) return;
    const dt = instant ? 0 : clamp(1 / 60, 0.001, 0.05);

    const { idx, f } = this.sampleAt(this.time);
    const a = j.samples[idx];
    const b = j.samples[Math.min(j.samples.length - 1, idx + 1)];
    const sample: JourneySample = {
      lng: a.lng + (b.lng - a.lng) * f,
      lat: a.lat + (b.lat - a.lat) * f,
      tMs: a.tMs + (b.tMs - a.tMs) * f,
      pb: this.time,
      dist: a.dist + (b.dist - a.dist) * f,
      bearing: a.bearing + angleDiff(a.bearing, b.bearing) * f,
      speed: a.speed + (b.speed - a.speed) * f,
      elev: a.elev + (b.elev - a.elev) * f,
      urban: a.urban,
      curviness: a.curviness,
    };

    let dBear = angleDiff(this.prevBearing, sample.bearing);
    this.prevBearing = sample.bearing;
    if (instant || !this.playing) dBear = 0;
    const bankTarget = clamp(dBear / Math.max(dt * this.rate, 0.02) * 0.55, -16, 16);
    this.bankSmoothed += (bankTarget - this.bankSmoothed) * (instant ? 1 : Math.min(1, dt * 3.2));

    this.fillElevation(j, idx);

    this.frameCb?.({ sample, idx, bankDeg: this.bankSmoothed });

    this.director.update(sample, idx, this.time, instant ? 0.016 : dt, instant);
    const cam = this.director.getCamera();
    map.jumpTo({
      center: [cam.lng, cam.lat],
      zoom: cam.zoom,
      pitch: cam.pitch,
      bearing: cam.bearing,
    });
  }

  sampleAt(pb: number): { idx: number; f: number } {
    const s = this.journey!.samples;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid].pb <= pb) lo = mid;
      else hi = mid;
    }
    const span = s[hi].pb - s[lo].pb;
    return { idx: lo, f: span > 0 ? clamp((pb - s[lo].pb) / span, 0, 1) : 0 };
  }

  private fillElevation(j: CompiledJourney, idx: number) {
    const map = this.map!;
    if (!map.terrain) return;
    for (let k = Math.max(0, idx - 8); k <= Math.min(j.samples.length - 1, idx + 40); k++) {
      const sm = j.samples[k];
      const key = `${sm.lat.toFixed(4)}:${sm.lng.toFixed(4)}`;
      if (!this.elevCache.has(key)) {
        let e: number | null = null;
        try {
          e = map.queryTerrainElevation([sm.lng, sm.lat]);
        } catch {}
        this.elevCache.set(key, e ?? 0);
      }
      sm.elev = this.elevCache.get(key)!;
    }
  }

  invalidateElevation() {
    this.elevCache.clear();
  }

  buildSnapshot(sample: JourneySample, idx: number, bankDeg: number): HudSnapshot {
    const j = this.journey!;
    let place = "";
    for (const ev of j.events) {
      if (ev.pb <= this.time && ev.name) place = ev.name;
    }
    const active = j.events
      .filter((ev) => {
        const d = this.time - ev.pb;
        return d >= 0 && d <= 3.5;
      })
      .map((ev) => ({ ...ev, remain: 3.5 - (this.time - ev.pb) }));
    return {
      time: this.time,
      duration: j.durationPb,
      playing: this.playing,
      rate: this.rate,
      clockMs: sample.tMs,
      distanceKm: sample.dist / 1000,
      totalKm: j.totalMeters / 1000,
      speedKmh: sample.speed * 3.6,
      altitudeM: sample.elev,
      remainingKm: Math.max(0, (j.totalMeters - sample.dist) / 1000),
      progressPct: (sample.dist / Math.max(1, j.totalMeters)) * 100,
      currentPlace: place,
      activeEvents: active,
      hasJourney: true,
      title: j.title,
    };
  }

  private notify(force: boolean) {
    if (!this.journey) {
      this.snapshot = EMPTY_SNAPSHOT;
      this.listeners.forEach((fn) => fn());
      return;
    }
    const now = performance.now();
    if (!force && now - this.lastNotify < 180) return;
    this.lastNotify = now;
    const { idx } = this.sampleAt(Math.min(this.time, this.journey.durationPb));
    const s = this.journey.samples[idx];
    this.snapshot = this.buildSnapshot(s, idx, this.bankSmoothed);
    this.listeners.forEach((fn) => fn());
  }
}
