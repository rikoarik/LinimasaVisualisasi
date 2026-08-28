import type { Map as MlMap } from "maplibre-gl";
import type { CompiledJourney, JourneyEvent, MapStyleId } from "../journey/types";
import type { HudSnapshot } from "./JourneyEngine";

export interface OverlayOptions {
  overlays: boolean;
  letterbox: boolean;
  trail: boolean;
  clear?: boolean;
}

export interface MarkerPx {
  x: number;
  y: number;
  label: string;
  kind: "start" | "end";
  visible: boolean;
}

const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

function moodFor(style: MapStyleId): { text: string; sub: string; accent: string; shadow: string } {
  if (style === "dark" || style === "cinematic" || style === "satellite") {
    return { text: "#ffffff", sub: "rgba(255,255,255,0.78)", accent: "#ffb547", shadow: "rgba(4,8,16,0.55)" };
  }
  return { text: "#0f172a", sub: "rgba(15,23,42,0.72)", accent: "#0284c7", shadow: "rgba(255,255,255,0.5)" };
}

export class OverlayRenderer {
  draw(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    hud: HudSnapshot,
    journey: CompiledJourney | null,
    map: MlMap | null,
    style: MapStyleId,
    opts: OverlayOptions
  ) {
    const u = H / 1080;
    if (opts.clear !== false) ctx.clearRect(0, 0, W, H);

    if (!journey) {
      this.drawEmptyState(ctx, W, H, u);
      return;
    }

    this.drawVignette(ctx, W, H);
    if (opts.trail) this.drawTrail(ctx, journey, map, style, hud);
    if (opts.overlays) {
      const m = moodFor(style);
      this.drawTitleBlock(ctx, W, u, hud, m);
      this.drawProgressRight(ctx, W, H, u, hud, m);
      this.drawEvents(ctx, W, H, u, hud.activeEvents, m);
    }
    if (opts.letterbox) this.drawLetterbox(ctx, W, H);
    if (opts.overlays) this.drawMarkers(ctx, journey, map, style, W, H, u, hud);
  }

  private drawVignette(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(2,6,14,0.34)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  private drawTrail(
    ctx: CanvasRenderingContext2D,
    journey: CompiledJourney,
    map: MlMap | null,
    style: MapStyleId,
    hud: HudSnapshot
  ) {
    if (!map || journey.samples.length < 2) return;
    const m = moodFor(style);
    const samples = journey.samples;
    const total = samples.length;
    const traveled = Math.max(2, Math.min(total, Math.round((hud.progressPct / 100) * total)));
    const step = Math.max(1, Math.floor(total / 420));

    const isIntro = hud.time < hud.introDur;
    const introProgress = isIntro ? hud.time / hud.introDur : 1;
    const isFinale = hud.time > hud.duration - hud.finaleDur;

    const projectPath = (from: number, to: number) => {
      ctx.beginPath();
      let started = false;
      for (let i = from; i <= to; i += step) {
        const s = samples[i];
        const p = map.project([s.lng, s.lat]);
        if (!isFinite(p.x) || !isFinite(p.y)) continue;
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else ctx.lineTo(p.x, p.y);
      }
    };

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (!isIntro) {
      const fadeAlpha = Math.min(1, (hud.time - hud.introDur) / 2.5);
      ctx.globalAlpha = fadeAlpha;
      ctx.setLineDash([7, 9]);
      projectPath(traveled - 1, total - 1);
      ctx.strokeStyle = style === "light" || style === "minimal" || style === "bright" ? "rgba(15,23,42,0.30)" : "rgba(255,255,255,0.30)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    if (traveled > 2) {
      const trailAlpha = isIntro ? introProgress * 0.4 : isFinale ? 1 : Math.min(1, (hud.time - hud.introDur) / 3);
      ctx.globalAlpha = Math.max(0.15, trailAlpha);
      ctx.shadowColor = m.accent;
      ctx.shadowBlur = 16;
      projectPath(0, traveled - 1);
      ctx.strokeStyle = m.accent;
      ctx.globalAlpha *= 0.18;
      ctx.lineWidth = 16;
      ctx.stroke();
      ctx.globalAlpha = trailAlpha * 0.5;
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.globalAlpha = Math.max(0.3, trailAlpha);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = style === "light" || style === "minimal" || style === "bright" ? "#0369a1" : "#ffd27a";
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  private drawLetterbox(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const bar = H * 0.055;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, bar);
    ctx.fillRect(0, H - bar, W, bar);
  }

  private drawTitleBlock(
    ctx: CanvasRenderingContext2D,
    _W: number,
    _H: number,
    hud: HudSnapshot,
    m: ReturnType<typeof moodFor>
  ) {
    const pad = 46;
    const fadeAlpha = Math.min(1, (hud.time + 0.5) / Math.max(1.5, hud.introDur * 0.5));
    ctx.save();
    ctx.globalAlpha = fadeAlpha;
    ctx.fillStyle = m.accent;
    ctx.fillRect(pad, pad, 52 * 1.4, 7);

    ctx.fillStyle = m.text;
    ctx.font = `700 ${Math.round(44)}px ${FONT}`;
    ctx.textBaseline = "top";
    ctx.fillText(hud.title, pad, pad + 20);

    const clock = isFinite(hud.clockMs)
      ? `${String(new Date(hud.clockMs).getHours()).padStart(2, "0")}:${String(new Date(hud.clockMs).getMinutes()).padStart(2, "0")}`
      : "--:--";
    ctx.fillStyle = m.sub;
    ctx.font = `500 ${Math.round(26)}px ${FONT}`;
    ctx.fillText(`${clock}   ·   ${hud.distanceKm.toFixed(1)} km traveled`, pad, pad + 82);
    ctx.restore();
  }

  private drawProgressRight(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    _u: number,
    hud: HudSnapshot,
    m: ReturnType<typeof moodFor>
  ) {
    const pad = 46;
    ctx.save();
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = m.sub;
    ctx.font = `600 ${Math.round(24)}px ${FONT}`;
    ctx.fillText(
      `${hud.progressPct.toFixed(0)}%  ·  ${Math.max(0, hud.totalKm - hud.distanceKm).toFixed(1)} km left`,
      W - pad,
      H - pad
    );
    ctx.restore();

    const barY = H - pad + 10;
    const barW = W - pad * 2;
    ctx.fillStyle = "rgba(128,140,160,0.35)";
    ctx.fillRect(pad, barY, barW, 5);
    ctx.fillStyle = m.accent;
    ctx.fillRect(pad, barY, barW * Math.min(1, hud.progressPct / 100), 5);
  }

  private drawEvents(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    _u: number,
    events: (JourneyEvent & { remain?: number })[],
    m: ReturnType<typeof moodFor>
  ) {
    if (!events.length) return;
    const ev = events[events.length - 1];
    const remain = ev.remain ?? 0;
    const appearT = clamp01((3.5 - remain) / 0.5);
    const fadeT = clamp01(remain / 0.85);
    const alpha = Math.min(appearT, fadeT);
    const slide = (1 - appearT) * 26;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(0, -slide);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(2,6,14,0.55)";
    ctx.shadowBlur = 8;
    const baseY = H * 0.845;
    if (ev.title) {
      ctx.fillStyle = m.accent;
      ctx.font = `800 ${Math.round(58)}px ${FONT}`;
      ctx.fillText(ev.title, W / 2, baseY - 74);
    }
    ctx.fillStyle = m.text;
    ctx.font = `${ev.title ? 600 : 700} ${Math.round(ev.title ? 40 : 52)}px ${FONT}`;
    ctx.fillText(ev.subtitle.toUpperCase(), W / 2, baseY);
    ctx.restore();
  }

  private drawMarkers(
    ctx: CanvasRenderingContext2D,
    journey: CompiledJourney,
    map: MlMap | null,
    _style: MapStyleId,
    W: number,
    H: number,
    _u: number,
    hud?: HudSnapshot
  ) {
    if (!map) return;
    const fadeAlpha = hud ? Math.min(1, (hud.time + 1) / Math.max(2, hud.introDur * 0.6)) : 1;
    const pts: MarkerPx[] = [];
    const s = journey.samples[0];
    const e = journey.samples[journey.samples.length - 1];
    try {
      const p1 = map.project([s.lng, s.lat]);
      pts.push({ x: p1.x, y: p1.y, label: "START", kind: "start", visible: true });
      const p2 = map.project([e.lng, e.lat]);
      pts.push({ x: p2.x, y: p2.y, label: "DESTINATION", kind: "end", visible: true });
    } catch {}
    for (const p of pts) {
      if (p.x < -60 || p.y < -60 || p.x > W + 60 || p.y > H + 60) continue;
      const r = p.kind === "start" ? 9 : 12;
      ctx.save();
      ctx.globalAlpha = fadeAlpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 7, 0, Math.PI * 2);
      ctx.strokeStyle = p.kind === "start" ? "rgba(56,189,248,0.85)" : "rgba(255,181,71,0.95)";
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = p.kind === "start" ? "#38bdf8" : "#ffb547";
      ctx.fill();
      ctx.shadowColor = "rgba(2,6,14,0.7)";
      ctx.shadowBlur = 10;
      ctx.font = `700 13px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillText(p.label, p.x, p.y - r - 12);
      ctx.restore();
    }
  }

  private drawEmptyState(ctx: CanvasRenderingContext2D, W: number, H: number, u: number) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(148,163,184,0.85)";
    ctx.font = `600 ${Math.round(30 * u * 1.2)}px ${FONT}`;
    ctx.fillText("No journey loaded", W / 2, H / 2);
    ctx.font = `500 ${Math.round(19 * u * 1.2)}px ${FONT}`;
    ctx.fillStyle = "rgba(100,116,139,0.8)";
    ctx.fillText(
      "Paste journey JSON or upload a Google Timeline export in the left panel",
      W / 2,
      H / 2 + 40 * u * 1.2
    );
    ctx.restore();
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
