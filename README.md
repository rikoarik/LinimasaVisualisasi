# 3D Journey Visualizer

Cinematic 3D travel visualizations from GPS/location JSON — a vehicle (car, motorcycle, bicycle, walker, bus, train, or airplane) travels a real 3D map while a cinematic camera system directs the shot. Export the result as video.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm start
npm run lint     # type-check
```

## Use

1. Paste journey JSON or upload a file (left panel) — the preview plays straight from your data:
   - Simple format: `{"title":"...","vehicle":"motorcycle","points":[{"lat","lng","timestamp","name"?}]}`
   - **Google Maps Timeline export** (`semanticSegments`) — trips are auto-extracted into a pickable list
   - GeoJSON LineString (with optional `coordTimes`)
2. Tune world (style/terrain/buildings/labels/trail), camera preset, then **Export Video**.

## Stack

- Next.js + TypeScript + Tailwind v4
- MapLibre GL JS — vector map, globe projection, terrain (Mapterhorn DEM), sky/fog, fill-extrusion buildings (OpenFreeMap tiles)
- Three.js — procedural low-poly vehicles rendered inside MapLibre's WebGL context via a custom layer
- Turf-style geo math — Catmull-Rom smoothing, arc-length resampling, bearings, stop compression
- WebCodecs + mp4-muxer — offline deterministic MP4 export (MediaRecorder fallback)

## Architecture notes

- `src/lib/journey/` — parsing, trip extraction, resampling, event detection
- `src/lib/cinematic/` — camera director state machine (intro → follow → finale), presets, smart zoom
- `src/lib/engine/` — imperative playback loop (no React state per frame), route layers, canvas overlay renderer (shared by preview and video export)
- `src/lib/three/` — vehicle models + georeferenced custom layer
- `src/lib/export/` — WebCodecs/MediaRecorder pipeline

All processing is client-side; no API keys or paid services.
