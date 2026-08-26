import type { CompiledJourney, CameraPreset, JourneySample } from "../journey/types";
import { angleDiff, clamp, damp, dampAngle, easeInOutCubic, easeOutCubic, lerp, smoothstep } from "./easing";
import { FOLLOW_LAMBDA, leadMeters, metersToDegLat, metersToDegLng, pitchFor, smartZoom } from "./smartZoom";

export interface CamState {
  lng: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

type Phase = "intro" | "travel" | "finale";

function fitZoom(journey: CompiledJourney): number {
  const [w, s] = journey.bounds[0];
  const [e, n] = journey.bounds[1];
  const dLat = Math.abs(n - s);
  const dLng = Math.abs(e - w);
  const span = Math.max(dLat, dLng * Math.cos((journey.samples[0].lat * Math.PI) / 180));
  return clamp(9.2 - Math.log2(Math.max(span, 0.002)) / 1.85, 1.4, 12.5);
}

export class Director {
  preset: CameraPreset = "auto";
  private cam: CamState = { lng: 0, lat: 0, zoom: 3, pitch: 0, bearing: 0 };
  private journey: CompiledJourney | null = null;
  private phase: Phase = "intro";
  private autoMode: "chase" | "drone" | "side" | "top" = "chase";
  private autoUntilPb = 0;
  private sideFlip = 1;
  private nextFlipPb = 20;
  private stopOrbitAngle = 0;
  private orbitSpin = 0;
  private finaleSnap: CamState | null = null;
  private straightSincePb = -1;

  reset(journey: CompiledJourney) {
    this.journey = journey;
    this.phase = "intro";
    this.autoMode = "chase";
    this.autoUntilPb = 0;
    this.sideFlip = 1;
    this.nextFlipPb = journey.durationPb * 0.15 + 14;
    this.stopOrbitAngle = 0;
    this.orbitSpin = 0;
    this.finaleSnap = null;
    this.straightSincePb = -1;
    const c = boundsCenter(journey);
    const z = fitZoom(journey);
    this.cam = { lng: c[0], lat: c[1], zoom: Math.max(z - 0.8, 1), pitch: 0, bearing: journey.samples[0].bearing };
  }

  getCamera(): CamState {
    return { ...this.cam };
  }

  snapTo(state: CamState) {
    this.cam = { ...state };
  }

  currentPhase(timePb: number): Phase {
    const j = this.journey!;
    if (timePb < j.introDur) return "intro";
    if (timePb > j.durationPb - j.finaleDur) return "finale";
    return "travel";
  }

  update(sample: JourneySample, idx: number, timePb: number, dt: number, instant: boolean) {
    const j = this.journey;
    if (!j) return;
    const newPhase = this.currentPhase(timePb);
    if (newPhase !== this.phase) {
      if (newPhase === "finale") {
        this.finaleSnap = { ...this.cam };
      }
      this.phase = newPhase;
    }
    let target: CamState;
    switch (this.phase) {
      case "intro":
        target = this.introTarget(timePb / j.introDur, j);
        break;
      case "finale":
        target = this.finaleTarget((timePb - (j.durationPb - j.finaleDur)) / j.finaleDur, j);
        break;
      default:
        target = this.travelTarget(sample, idx, timePb, dt, instant, j);
    }
    if (instant) {
      this.cam = target;
      return;
    }
    const lam =
      this.phase === "travel"
        ? FOLLOW_LAMBDA[this.preset === "auto" ? "auto" : this.preset]
        : { bearing: 2.0, center: 2.6, zoom: 2.2, pitch: 2.4 };
    this.cam.lng = damp(this.cam.lng, target.lng, lam.center, dt);
    this.cam.lat = damp(this.cam.lat, target.lat, lam.center, dt);
    this.cam.zoom = damp(this.cam.zoom, target.zoom, lam.zoom, dt);
    this.cam.pitch = damp(this.cam.pitch, target.pitch, lam.pitch, dt);
    this.cam.bearing = dampAngle(this.cam.bearing, target.bearing, this.preset === "orbit" ? 99 : lam.bearing, dt);
  }

  private introTarget(t01: number, j: CompiledJourney): CamState {
    const e = easeInOutCubic(t01);
    const s0 = j.samples[0];
    const overviewZoom = fitZoom(j) - 0.4;
    const startBearing = s0.bearing;
    if (t01 < 0.42) {
      const f = smoothstep(t01 / 0.42);
      const c = boundsCenter(j);
      const backLng = s0.lng - metersToDegLng(600, s0.lat);
      const backLat = s0.lat - metersToDegLat(600);
      return {
        lng: lerp(c[0], backLng, f),
        lat: lerp(c[1], backLat, f),
        zoom: lerp(overviewZoom, 13.2, f),
        pitch: lerp(0, 38, f),
        bearing: lerp(startBearing - 50, startBearing - 18, f),
      };
    }
    const f = easeOutCubic((t01 - 0.42) / 0.58);
    const lead = leadMeters("chase", s0.speed || 3);
    return {
      lng: s0.lng + metersToDegLng(lead * 0.7, s0.lat),
      lat: s0.lat + metersToDegLat(lead * 0.7),
      zoom: lerp(13.2, 16.6, f),
      pitch: lerp(38, 60, f),
      bearing: lerp(startBearing - 18, startBearing, f),
    };
  }

  private travelTarget(
    sample: JourneySample,
    idx: number,
    timePb: number,
    _dt: number,
    _instant: boolean,
    j: CompiledJourney
  ): CamState {
    const preset = this.effectivePreset(sample, timePb, j);
    const speed = sample.speed;
    const stopped = speed < 0.55 && timePb > j.introDur + 2;

    if (stopped) {
      this.stopOrbitAngle += 10;
      const b = sample.bearing - 90 + Math.sin((this.stopOrbitAngle * Math.PI) / 180) * 34;
      return {
        lng: sample.lng,
        lat: sample.lat,
        zoom: smartZoom(preset, sig(sample)) + 0.5,
        pitch: 60,
        bearing: b,
      };
    }
    this.stopOrbitAngle = 0;

    const lead = leadMeters(preset, speed);
    const sway = Math.sin(timePb * 0.45) * 0.28 + Math.sin(timePb * 0.13) * 0.35;

    switch (preset) {
      case "orbit": {
        this.orbitSpin += 11;
        return {
          lng: sample.lng,
          lat: sample.lat,
          zoom: smartZoom(preset, sig(sample)),
          pitch: 62,
          bearing: sample.bearing - 130 + this.orbitSpin,
        };
      }
      case "side": {
        const perpB = sample.bearing + 90 * this.sideFlip;
        return {
          lng: sample.lng + metersToDegLng(Math.cos((perpB * Math.PI) / 180) * 26 + Math.sin((sample.bearing * Math.PI) / 180) * lead, sample.lat),
          lat: sample.lat + metersToDegLat(Math.sin((perpB * Math.PI) / 180) * 26 + Math.cos((sample.bearing * Math.PI) / 180) * lead),
          zoom: smartZoom(preset, sig(sample)) + sway * 0.06,
          pitch: pitchFor(preset, sample.urban, slopeOf(j, idx)),
          bearing: sample.bearing,
        };
      }
      case "top": {
        return {
          lng: sample.lng + metersToDegLng(Math.sin((sample.bearing * Math.PI) / 180) * lead * 0.6, sample.lat),
          lat: sample.lat + metersToDegLat(Math.cos((sample.bearing * Math.PI) / 180) * lead * 0.6),
          zoom: smartZoom(preset, sig(sample)),
          pitch: pitchFor(preset, sample.urban, 0),
          bearing: sample.bearing + sway * 4,
        };
      }
      case "drone": {
        return {
          lng: sample.lng + metersToDegLng(Math.sin((sample.bearing * Math.PI) / 180) * lead + Math.sin(((sample.bearing + 90) * Math.PI) / 180) * sway * 40, sample.lat),
          lat: sample.lat + metersToDegLat(Math.cos((sample.bearing * Math.PI) / 180) * lead + Math.cos(((sample.bearing + 90) * Math.PI) / 180) * sway * 40),
          zoom: smartZoom(preset, sig(sample)),
          pitch: pitchFor(preset, sample.urban, slopeOf(j, idx)),
          bearing: sample.bearing + angleDiff(sample.bearing, this.cam.bearing) * 0.12,
        };
      }
      default: {
        return {
          lng: sample.lng + metersToDegLng(Math.sin((sample.bearing * Math.PI) / 180) * lead + Math.sin(((sample.bearing + 90) * Math.PI) / 180) * sway * 22, sample.lat),
          lat: sample.lat + metersToDegLat(Math.cos((sample.bearing * Math.PI) / 180) * lead + Math.cos(((sample.bearing + 90) * Math.PI) / 180) * sway * 22),
          zoom: smartZoom(this.preset === "auto" ? "chase" : preset, sig(sample)),
          pitch: pitchFor(this.preset === "auto" ? "chase" : preset, sample.urban, slopeOf(j, idx)),
          bearing: sample.bearing + sway * 2.5,
        };
      }
    }
  }

  private effectivePreset(sample: JourneySample, timePb: number, j: CompiledJourney): CameraPreset {
    if (j.isFlight) return "drone";
    if (this.preset !== "auto") return this.preset;
    if (timePb >= this.autoUntilPb) {
      const prevMode = this.autoMode;
      if (timePb > this.nextFlipPb) {
        this.sideFlip *= -1;
        this.nextFlipPb = timePb + 26 + Math.random() * 18;
      }
      if (sample.curviness > 0.45 && sample.urban > 0.42 && prevMode !== "side") {
        this.autoMode = "side";
        this.autoUntilPb = timePb + 4.5;
      } else if (sample.speed > 19 && prevMode !== "drone") {
        this.autoMode = "drone";
        this.autoUntilPb = timePb + 7;
      } else if (sample.urban > 0.62 && prevMode !== "top") {
        this.autoMode = "top";
        this.autoUntilPb = timePb + 3.5;
      } else {
        this.autoMode = "chase";
        this.autoUntilPb = timePb + 4;
      }
    }
    return this.autoMode;
  }

  private finaleTarget(t01: number, j: CompiledJourney): CamState {
    const dest = j.samples[j.samples.length - 1];
    const e = easeInOutCubic(clamp(t01, 0, 1));
    const snap = this.finaleSnap ?? { lng: dest.lng, lat: dest.lat, zoom: 15, pitch: 60, bearing: dest.bearing };
    const revealZoom = fitZoom(j);
    const orbitZoomEnd = smartZoom("chase", sig(dest)) + 0.4;
    if (t01 < 0.55) {
      const f = t01 / 0.55;
      const eased = easeInOutCubic(f);
      return {
        lng: dest.lng,
        lat: dest.lat,
        zoom: lerp(snap.zoom, orbitZoomEnd, eased),
        pitch: lerp(snap.pitch, 58, eased),
        bearing: snap.bearing + eased * 150,
      };
    }
    const f = easeOutCubic((t01 - 0.55) / 0.45);
    const c = boundsCenter(j);
    return {
      lng: c[0],
      lat: lerp(dest.lat, c[1], f * 0.9),
      zoom: lerp(orbitZoomEnd, revealZoom, f),
      pitch: lerp(58, 30, f),
      bearing: snap.bearing + 150 + f * 120,
    };
  }
}

function sig(sample: JourneySample) {
  return { speedMs: sample.speed, urban: sample.urban, slope: 0, curviness: sample.curviness };
}

function slopeOf(j: CompiledJourney, idx: number): number {
  const a = j.samples[Math.max(0, idx - 6)];
  const b = j.samples[Math.min(j.samples.length - 1, idx + 6)];
  const dx = Math.max(1, b.dist - a.dist);
  return Math.max(0, (b.elev - a.elev) / dx);
}

export function boundsCenter(j: CompiledJourney): [number, number] {
  const [w, s] = j.bounds[0];
  const [e, n] = j.bounds[1];
  return [(w + e) / 2, (s + n) / 2];
}
