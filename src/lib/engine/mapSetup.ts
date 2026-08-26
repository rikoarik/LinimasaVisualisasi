import type { Map as MlMap, StyleSpecification } from "maplibre-gl";
import type { CompiledJourney, MapStyleId } from "../journey/types";

export const TERRAIN_URL = "https://tiles.mapterhorn.com/tilejson.json";
const OFM_VECTOR_URL = "https://tiles.openfreemap.org/planet";

export const STYLE_URLS: Record<Exclude<MapStyleId, "satellite" | "cinematic">, string> = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
  minimal: "https://tiles.openfreemap.org/styles/positron",
  bright: "https://tiles.openfreemap.org/styles/bright",
};

export interface SkyMood {
  skyColor: string;
  horizonColor: string;
  fogColor: string;
  skyHorizonBlend: number;
  horizonFogBlend: number;
  fogGroundBlend: number;
}

const SKY_MOODS: Record<string, SkyMood> = {
  cinematic: {
    skyColor: "#0b1026",
    horizonColor: "#e08c3c",
    fogColor: "#1a2035",
    skyHorizonBlend: 0.6,
    horizonFogBlend: 0.4,
    fogGroundBlend: 0.55,
  },
  light: {
    skyColor: "#9ec7ee",
    horizonColor: "#dcebf7",
    fogColor: "#dfe8f0",
    skyHorizonBlend: 0.5,
    horizonFogBlend: 0.5,
    fogGroundBlend: 0.5,
  },
  dark: {
    skyColor: "#05070f",
    horizonColor: "#1c2740",
    fogColor: "#0a0e18",
    skyHorizonBlend: 0.6,
    horizonFogBlend: 0.45,
    fogGroundBlend: 0.6,
  },
  satellite: {
    skyColor: "#0a1222",
    horizonColor: "#39567a",
    fogColor: "#101a2c",
    skyHorizonBlend: 0.65,
    horizonFogBlend: 0.35,
    fogGroundBlend: 0.5,
  },
};

function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      satellite: {
        type: "raster",
        tiles: [
          "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg",
        ],
        tileSize: 256,
        maxzoom: 14,
        attribution: "Sentinel-2 cloudless © EOX IT Services (contains modified Copernicus Sentinel data)",
      },
      ofm: { type: "vector", url: OFM_VECTOR_URL },
      terrain: { type: "raster-dem", url: TERRAIN_URL },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0a1222" } },
      { id: "sat", type: "raster", source: "satellite", paint: { "raster-opacity": 1 } },
    ],
  };
}

async function cinematicStyle(): Promise<StyleSpecification> {
  const res = await fetch("https://tiles.openfreemap.org/styles/liberty");
  const style = (await res.json()) as StyleSpecification & { layers: any[] };
  for (const layer of style.layers) {
    if (layer.type === "symbol") {
      layer.layout = { ...layer.layout, visibility: "none" };
    }
  }
  return style;
}

export async function resolveStyle(id: MapStyleId): Promise<string | StyleSpecification> {
  if (id === "satellite") return satelliteStyle();
  if (id === "cinematic") return cinematicStyle();
  return STYLE_URLS[id];
}

export function applySky(map: MlMap, moodKey: string) {
  const m = SKY_MOODS[moodKey] ?? SKY_MOODS.light;
  map.setSky({
    "sky-color": m.skyColor,
    "horizon-color": m.horizonColor,
    "fog-color": m.fogColor,
    "sky-horizon-blend": m.skyHorizonBlend,
    "horizon-fog-blend": m.horizonFogBlend,
    "fog-ground-blend": m.fogGroundBlend,
  });
}

export function ensureTerrainSource(map: MlMap) {
  if (!map.getSource("jv-terrain")) {
    map.addSource("jv-terrain", { type: "raster-dem", url: TERRAIN_URL });
  }
}

export function setTerrainEnabled(map: MlMap, enabled: boolean) {
  ensureTerrainSource(map);
  if (enabled) {
    map.setTerrain({ source: "jv-terrain", exaggeration: 1.15 });
  } else {
    map.setTerrain(null);
  }
}

export function addBuildingsLayer(map: MlMap, enabled: boolean): boolean {
  try {
    if (!map.getSource("ofm-vector")) {
      map.addSource("ofm-vector", { type: "vector", url: OFM_VECTOR_URL });
    }
    if (map.getLayer("jv-buildings")) return true;
    const layers = map.getStyle().layers ?? [];
    let beforeId: string | undefined;
    for (const l of layers) {
      if (l.type === "symbol" && ((l as any).layout?.["text-field"] !== undefined || (l as any).layout?.["symbol-placement"] === undefined)) {
        beforeId = l.id;
        break;
      }
    }
    map.addLayer(
      {
        id: "jv-buildings",
        type: "fill-extrusion",
        source: "ofm-vector",
        "source-layer": "building",
        minzoom: 13,
        filter: ["!=", ["get", "hide_3d"], true],
        paint: {
          "fill-extrusion-color": [
            "interpolate",
            ["linear"],
            ["get", "render_height"],
            0,
            "#8d97ad",
            120,
            "#6f7b96",
            300,
            "#586480",
          ],
          "fill-extrusion-height": [
            "interpolate",
            ["linear"],
            ["zoom"],
            13,
            0,
            15,
            ["coalesce", ["get", "render_height"], 8],
          ],
          "fill-extrusion-base": ["case", [">=", ["zoom"], 15], ["coalesce", ["get", "render_min_height"], 0], 0],
          "fill-extrusion-opacity": 0.92,
        },
      },
      beforeId
    );
    map.setLayoutProperty("jv-buildings", "visibility", enabled ? "visible" : "none");
    return true;
  } catch {
    return false;
  }
}

export function setBuildingsEnabled(map: MlMap, enabled: boolean) {
  if (map.getLayer("jv-buildings")) {
    map.setLayoutProperty("jv-buildings", "visibility", enabled ? "visible" : "none");
  }
}

export function setLabelsEnabled(map: MlMap, enabled: boolean) {
  const style = map.getStyle();
  if (!style?.layers) return;
  for (const l of style.layers) {
    if (l.type === "symbol" && l.id.startsWith("jv-") === false) {
      try {
        map.setLayoutProperty(l.id, "visibility", enabled ? "visible" : "none");
      } catch {}
    }
  }
}

export function setGlobe(map: MlMap, globe: boolean) {
  try {
    map.setProjection({ type: globe ? "globe" : "mercator" });
  } catch {}
}

export function fitJourneyBounds(map: MlMap, journey: CompiledJourney, paddingPx = 80) {
  map.fitBounds(journey.bounds as never, { padding: paddingPx, duration: 0, pitch: 0, bearing: 0 });
}
