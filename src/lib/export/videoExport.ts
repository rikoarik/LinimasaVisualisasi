import type { Map as MlMap } from "maplibre-gl";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { CompiledJourney, MapStyleId } from "../journey/types";
import { JourneyEngine } from "../engine/JourneyEngine";
import { OverlayRenderer } from "../engine/overlayRenderer";

export type AspectId = "16:9" | "9:16" | "1:1" | "4:5";

export interface ExportSettings {
  trail?: boolean;
  aspect: AspectId;
  resolution: 720 | 1080;
  fps: 30 | 60;
  durationSec: number | "auto";
  overlays: boolean;
  letterbox: boolean;
}

export interface ExportProgress {
  phase: "preparing" | "rendering" | "encoding" | "done";
  frame: number;
  totalFrames: number;
  pct: number;
}

export const ASPECTS: Record<AspectId, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
};

export function outputSize(aspect: AspectId, resolution: 720 | 1080): { w: number; h: number } {
  const ratio = ASPECTS[aspect];
  let w: number;
  let h: number;
  if (ratio >= 1) {
    h = resolution;
    w = Math.round(h * ratio / 2) * 2;
  } else {
    w = resolution;
    h = Math.round(w / ratio / 2) * 2;
  }
  return { w: Math.max(2, w), h: Math.max(2, h) };
}

const CODEC_CANDIDATES = ["avc1.640034", "avc1.4d0034", "avc1.42003e", "avc1.42001f"];

async function pickCodec(w: number, h: number, fps: number, bitrate: number): Promise<string | null> {
  if (typeof VideoEncoder === "undefined") return null;
  for (const codec of CODEC_CANDIDATES) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width: w,
        height: h,
        bitrate,
        framerate: fps,
      });
      if (support.supported) return codec;
    } catch {}
  }
  return null;
}

function nextRender(map: MlMap): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => resolve();
    map.once("render", handler);
    map.triggerRepaint();
    setTimeout(() => resolve(), 400);
  });
}

export async function exportJourneyVideo(opts: {
  map: MlMap;
  engine: JourneyEngine;
  journey: CompiledJourney;
  overlayRenderer: OverlayRenderer;
  styleId: MapStyleId;
  settings: ExportSettings;
  onProgress: (p: ExportProgress) => void;
  cancelled: () => boolean;
}): Promise<{ blob: Blob; ext: string }> {
  const { map, engine, journey, overlayRenderer, settings } = opts;
  const { w, h } = outputSize(settings.aspect, settings.resolution);
  const wallDuration =
    settings.durationSec === "auto" ? journey.durationPb : settings.durationSec;
  const totalFrames = Math.max(2, Math.round(wallDuration * settings.fps));

  const container = map.getContainer();
  const prevCss = container.style.cssText;
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = `${w}px`;
  container.style.height = `${h}px`;
  engine.pause();
  map.resize();

  opts.onProgress({ phase: "preparing", frame: 0, totalFrames, pct: 0 });

  try {
    for (let i = 0; i <= 20; i++) {
      engine.seek((i / 20) * journey.durationPb);
      await nextRender(map);
      if (opts.cancelled()) throw new Error("cancelled");
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: false })!;

    const bitrate = Math.round(
      Math.min(18_000_000, Math.max(4_500_000, w * h * settings.fps * 0.11))
    );
    const codec = await pickCodec(w, h, settings.fps, bitrate);

    if (codec) {
      opts.onProgress({ phase: "rendering", frame: 0, totalFrames, pct: 0 });
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: "avc", width: w, height: h, frameRate: settings.fps },
        fastStart: "in-memory",
      });
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => console.error("encoder", e),
      });
      encoder.configure({ codec, width: w, height: h, bitrate, framerate: settings.fps });

      for (let fIdx = 0; fIdx < totalFrames; fIdx++) {
        if (opts.cancelled()) throw new Error("cancelled");
        engine.seek((fIdx / totalFrames) * journey.durationPb);
        await nextRender(map);
        ctx.drawImage(map.getCanvas(), 0, 0, w, h);
        if (settings.overlays || settings.letterbox) {
          const hud = engine.getHud();
          overlayRenderer.draw(ctx, w, h, hud, journey, map, opts.styleId, {
            overlays: settings.overlays,
            letterbox: settings.letterbox,
            trail: settings.trail ?? true,
          });
        }
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((fIdx * 1e6) / settings.fps),
          duration: Math.round(1e6 / settings.fps),
        });
        encoder.encode(frame, { keyFrame: fIdx % (settings.fps * 2) === 0 });
        frame.close();
        while (encoder.encodeQueueSize > 6) {
          await new Promise((r) => setTimeout(r, 4));
        }
        if (fIdx % 3 === 0) {
          opts.onProgress({
            phase: "rendering",
            frame: fIdx,
            totalFrames,
            pct: (fIdx / totalFrames) * 92,
          });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      opts.onProgress({ phase: "encoding", frame: totalFrames, totalFrames, pct: 93 });
      await encoder.flush();
      muxer.finalize();
      const buffer = (muxer.target as ArrayBufferTarget).buffer;
      opts.onProgress({ phase: "done", frame: totalFrames, totalFrames, pct: 100 });
      return { blob: new Blob([buffer], { type: "video/mp4" }), ext: "mp4" };
    }

    return await mediaRecorderFallback({
      map,
      engine,
      journey,
      overlayRenderer,
      ctx,
      canvas,
      w,
      h,
      settings,
      wallDuration,
      onProgress: opts.onProgress,
      cancelled: opts.cancelled,
      styleId: opts.styleId,
    });
  } finally {
    container.style.cssText = prevCss;
    map.resize();
    engine.seek(engine.time);
  }
}

async function mediaRecorderFallback(o: {
  map: MlMap;
  engine: JourneyEngine;
  journey: CompiledJourney;
  overlayRenderer: OverlayRenderer;
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  settings: ExportSettings;
  wallDuration: number;
  styleId: MapStyleId;
  onProgress: (p: ExportProgress) => void;
  cancelled: () => boolean;
}): Promise<{ blob: Blob; ext: string }> {
  const stream = o.canvas.captureStream(o.settings.fps);
  const mimeCandidates = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"];
  const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12_000_000 } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const done = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start(200);
  const startWall = performance.now();
  o.engine.seek(0);
  o.engine.play();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const elapsed = (performance.now() - startWall) / 1000;
      o.ctx.drawImage(o.map.getCanvas(), 0, 0, o.w, o.h);
      const hud = o.engine.getHud();
      o.overlayRenderer.draw(o.ctx, o.w, o.h, hud, o.journey, o.map, o.styleId, {
        overlays: o.settings.overlays,
        letterbox: o.settings.letterbox,
        trail: o.settings.trail ?? true,
      });
      o.onProgress({
        phase: "rendering",
        frame: Math.round(elapsed * o.settings.fps),
        totalFrames: Math.round(o.wallDuration * o.settings.fps),
        pct: Math.min(92, (elapsed / o.wallDuration) * 92),
      });
      if (elapsed >= o.wallDuration || o.cancelled()) {
        o.engine.pause();
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  recorder.stop();
  await done;
  const ext = mime.includes("mp4") ? "mp4" : "webm";
  o.onProgress({ phase: "done", frame: 0, totalFrames: 0, pct: 100 });
  return { blob: new Blob(chunks, { type: mime || "video/webm" }), ext };
}
