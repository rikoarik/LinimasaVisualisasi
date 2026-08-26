import type { Map as MlMap, GeoJSONSource } from "maplibre-gl";
import type { Feature, LineString } from "geojson";
import type { CompiledJourney, MapStyleId } from "../journey/types";

const SRC_FULL = "jv-route-full";
const SRC_DONE = "jv-route-done";

export interface RouteColors {
  done: string;
  doneGlow: string;
  upcoming: string;
}

function colorsFor(style: MapStyleId): RouteColors {
  switch (style) {
    case "dark":
    case "cinematic":
      return { done: "#ffb547", doneGlow: "#ff9a1f", upcoming: "rgba(255,255,255,0.28)" };
    case "satellite":
      return { done: "#ffe14d", doneGlow: "#ffbe0b", upcoming: "rgba(255,255,255,0.75)" };
    default:
      return { done: "#0ea5e9", doneGlow: "#38bdf8", upcoming: "rgba(30,41,59,0.35)" };
  }
}

function sliceLine(coords: [number, number][], upTo: number): Feature<LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: coords.slice(0, Math.max(2, upTo)) },
  };
}

export class RouteLayers {
  private coords: [number, number][] = [];
  private lastIdx = -1;
  private colors: RouteColors;

  constructor(private map: MlMap) {
    this.colors = colorsFor("light");
  }

  install(journey: CompiledJourney | null, style: MapStyleId, trailVisible: boolean) {
    const map = this.map;
    this.colors = colorsFor(style);
    this.lastIdx = -1;

    if (!journey) return;
    this.coords = journey.lineFull.geometry.coordinates as [number, number][];

    if (!map.getSource(SRC_FULL)) {
      map.addSource(SRC_FULL, { type: "geojson", data: journey.lineFull });
      map.addSource(SRC_DONE, { type: "geojson", data: sliceLine(this.coords, 1) });
    } else {
      (map.getSource(SRC_FULL) as GeoJSONSource).setData(journey.lineFull);
      (map.getSource(SRC_DONE) as GeoJSONSource).setData(sliceLine(this.coords, 1));
    }

    const firstSym = map.getStyle().layers?.find((l) => l.type === "symbol")?.id;

    const add = (layer: maplibregl.LayerSpecification) => {
      if (!map.getLayer(layer.id)) map.addLayer(layer, firstSym);
    };

    add({
      id: "jv-route-upcoming",
      type: "line",
      source: SRC_FULL,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": this.colors.upcoming,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 6, 17, 10],
        "line-dasharray": [0.5, 1.6],
      },
    } as never);

    add({
      id: "jv-route-glow",
      type: "line",
      source: SRC_DONE,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": this.colors.doneGlow,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 8, 14, 16, 17, 26],
        "line-blur": ["interpolate", ["linear"], ["zoom"], 8, 6, 14, 12, 17, 20],
        "line-opacity": 0.55,
      },
    } as never);

    add({
      id: "jv-route-core",
      type: "line",
      source: SRC_DONE,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": this.colors.done,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 14, 4.5, 17, 7],
      },
    } as never);

    this.setVisible(trailVisible);
  }

  setVisible(visible: boolean) {
    for (const id of ["jv-route-upcoming", "jv-route-glow", "jv-route-core"]) {
      if (this.map.getLayer(id)) {
        this.map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      }
    }
  }

  remove() {
    for (const id of ["jv-route-upcoming", "jv-route-glow", "jv-route-core"]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    for (const id of [SRC_FULL, SRC_DONE]) {
      if (this.map.getSource(id)) this.map.removeSource(id);
    }
  }

  updateProgress(idx: number) {
    if (idx === this.lastIdx || !this.coords.length) return;
    this.lastIdx = idx;
    (this.map.getSource(SRC_DONE) as GeoJSONSource)?.setData(sliceLine(this.coords, idx + 2));
  }
}
