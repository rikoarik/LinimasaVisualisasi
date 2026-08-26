"use client";

import { useEffect, useRef } from "react";
import type { Map as MlMap, StyleSpecification } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import * as THREE from "three";
import type {
  CameraPreset,
  CompiledJourney,
  MapStyleId,
} from "@/lib/journey/types";
import { JourneyEngine } from "@/lib/engine/JourneyEngine";
import { RouteLayers } from "@/lib/engine/routeLayers";
import { OverlayRenderer } from "@/lib/engine/overlayRenderer";
import {
  addBuildingsLayer,
  applySky,
  resolveStyle,
  setBuildingsEnabled,
  setGlobe,
  setLabelsEnabled,
  setTerrainEnabled,
} from "@/lib/engine/mapSetup";
import { VehicleLayer } from "@/lib/three/vehicleLayer";

export interface WorldToggles {
  terrain: boolean;
  buildings: boolean;
  labels: boolean;
  trail: boolean;
}

export interface StageApi {
  map: MlMap;
  engine: JourneyEngine;
  routeLayers: RouteLayers;
  overlay: OverlayRenderer;
  loadJourney(journey: CompiledJourney, trail: boolean): void;
}

interface Props {
  styleId: MapStyleId;
  world: WorldToggles;
  preset: CameraPreset;
  onReady: (api: StageApi) => void;
}

const SKY_KEY_FOR_STYLE: Record<MapStyleId, string> = {
  cinematic: "cinematic",
  light: "light",
  dark: "dark",
  minimal: "light",
  bright: "light",
  satellite: "satellite",
};

export default function MapStage({ styleId, world, preset, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const engineRef = useRef<JourneyEngine | null>(null);
  const vehicleLayerRef = useRef<VehicleLayer | null>(null);
  const routeLayersRef = useRef<RouteLayers | null>(null);
  const overlayRef = useRef<OverlayRenderer>(new OverlayRenderer());
  const journeyRef = useRef<CompiledJourney | null>(null);
  const styleRef = useRef(styleId);
  const worldRef = useRef(world);
  const lastFrameTs = useRef(0);
  const readyRef = useRef(onReady);

  styleRef.current = styleId;
  worldRef.current = world;
  readyRef.current = onReady;

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    const engine = new JourneyEngine();
    engineRef.current = engine;
    const vehicleLayer = new VehicleLayer();
    vehicleLayerRef.current = vehicleLayer;

    let lastPoseTs = performance.now();
    engine.setFrameCallback(({ sample, idx, bankDeg }) => {
      const vl = vehicleLayerRef.current;
      if (!vl) return;
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0.001, (now - lastPoseTs) / 1000));
      lastPoseTs = now;
      vl.setPose(
        {
          lng: sample.lng,
          lat: sample.lat,
          elev: sample.elev,
          bearing: sample.bearing,
          bank: bankDeg,
          pitch: 0,
          speed: sample.speed,
          visible: true,
        },
        dt
      );
      routeLayersRef.current?.updateProgress(idx);
    });

    const drawOverlay = () => {
      const map = mapRef.current;
      const canvas = canvasRef.current;
      if (!map || !canvas || disposed) return;
      const rect = containerRef.current!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(2, Math.round(rect.width));
      const h = Math.max(2, Math.round(rect.height));
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      overlayRef.current.draw(
        ctx,
        w,
        h,
        engine.getHud(),
        journeyRef.current,
        map,
        styleRef.current,
        {
          overlays: true,
          letterbox: false,
          trail: worldRef.current.trail,
        }
      );
      ctx.restore();
    };

    (async () => {
      const style = await resolveStyle(styleRef.current);
      if (disposed || !containerRef.current) return;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: style as string | StyleSpecification,
        center: [110, -4],
        zoom: 4.2,
        pitch: 30,
        bearing: 0,
        maxPitch: 85,
        attributionControl: { compact: true },
        fadeDuration: 0,
        canvasContextAttributes: {
          antialias: true,
        },
      });
      mapRef.current = map;
      engine.map = map;
      routeLayersRef.current = new RouteLayers(map);
      try {
        map.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      } catch {}

      map.on("load", () => {
        applyWorldToMap(map, styleRef.current, worldRef.current, journeyRef.current?.isFlight ?? false);
        vehicleLayer.attach(map, () => engine.playing);
        engine.startLoop();
        readyRef.current({
          map,
          engine,
          routeLayers: routeLayersRef.current!,
          overlay: overlayRef.current,
          loadJourney(journey, trail) {
            journeyRef.current = journey;
            engine.load(journey);
            vehicleLayer.setVehicle(journey.vehicle);
            routeLayersRef.current!.install(journey, styleRef.current, trail);
            setGlobe(map, journey.isFlight);
            map.jumpTo({
              center: [
                (journey.bounds[0][0] + journey.bounds[1][0]) / 2,
                (journey.bounds[0][1] + journey.bounds[1][1]) / 2,
              ],
              zoom: 5,
              pitch: 0,
              bearing: 0,
            });
            engine.applyFrame(true);
          },
        });
        const w = window as never as Record<string, unknown>;
        w.__jvVL = vehicleLayer;
        w.__jvTHREE = THREE;
        w.__jvMerc = maplibregl.MercatorCoordinate;
        w.__jvMapReady = true;
      });

      map.on("style.load", () => {
        applyWorldToMap(map, styleRef.current, worldRef.current, journeyRef.current?.isFlight ?? false);
        if (journeyRef.current && routeLayersRef.current) {
          routeLayersRef.current.install(
            journeyRef.current,
            styleRef.current,
            worldRef.current.trail
          );
        }
        engine.invalidateElevation();
        engine.applyFrame(true);
      });

      map.on("render", drawOverlay);
      window.addEventListener("resize", drawOverlay);
    })();

    return () => {
      disposed = true;
      window.removeEventListener("resize", drawOverlay);
      engine.stopLoop();
      engine.setFrameCallback(null);
      try {
        mapRef.current?.remove();
      } catch {}
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    (async () => {
      const style = await resolveStyle(styleId);
      map.setStyle(style as string | StyleSpecification);
    })();
  }, [styleId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    setTerrainEnabled(map, world.terrain);
    setBuildingsEnabled(map, world.buildings);
    setLabelsEnabled(map, world.labels);
    routeLayersRef.current?.setVisible(world.trail);
  }, [world]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.director.preset = preset;
  }, [preset]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0a0e17]">
      <div ref={containerRef} className="absolute inset-0" />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
    </div>
  );
}

function applyWorldToMap(
  map: MlMap,
  styleId: MapStyleId,
  world: WorldToggles,
  isFlight: boolean
) {
  applySky(map, SKY_KEY_FOR_STYLE[styleId]);
  setTerrainEnabled(map, world.terrain);
  addBuildingsLayer(map, world.buildings);
  setLabelsEnabled(map, world.labels);
  setGlobe(map, isFlight);
}
