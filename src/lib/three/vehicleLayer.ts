import type { CustomLayerInterface, Map as MlMap } from "maplibre-gl";
import { MercatorCoordinate } from "maplibre-gl";
import * as THREE from "three";
import type { VehicleKind } from "../journey/types";
import { buildVehicle, type VehicleModel } from "./vehicles";

export interface VehiclePose {
  lng: number;
  lat: number;
  elev: number;
  bearing: number;
  bank: number;
  pitch: number;
  speed: number;
  visible: boolean;
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

const EARTH_RADIUS = 6371008.8;

export class VehicleLayer {
  private map: MlMap | null = null;
  private layer: CustomLayerInterface | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private camera = new THREE.Camera();
  private scene = new THREE.Scene();
  private model: VehicleModel | null = null;
  private pose: VehiclePose | null = null;
  private animPhase = 0;
  kind: VehicleKind = "car";

  attach(map: MlMap) {
    if (this.layer) return;
    this.map = map;
    const self = this;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.15));
    const sun = new THREE.DirectionalLight(0xfff3e0, 1.35);
    sun.position.set(-60, 90, -40).normalize();
    this.scene.add(sun);

    this.layer = {
      id: "jv-vehicle",
      type: "custom",
      renderingMode: "3d",
      onAdd(_map, gl) {
        self.renderer = new THREE.WebGLRenderer({
          canvas: _map.getCanvas(),
          context: gl,
          antialias: true,
        });
        self.renderer.autoClear = false;
      },
      render(_gl, args) {
        if (!self.renderer || !self.pose || !self.pose.visible || !self.model) return;
        if (!self.map) return;
        const map = self.map as unknown as MlMap & { transform: any };
        let l: THREE.Matrix4;
        const transition = (args.defaultProjectionData as any).projectionTransition ?? 0;
        if (transition > 0.001) {
          l = globeModelMatrix(self.pose.lng, self.pose.lat, self.pose.elev);
          const zoom = map.getZoom();
          const boost = Math.min(280, Math.pow(2, Math.max(0, 13 - zoom)) * 0.9);
          l.multiply(new THREE.Matrix4().makeScale(boost, boost, boost));
        } else {
          l = mercatorModelMatrix(map, self.pose);
        }
        const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix as never);
        self.camera.projectionMatrix = m.multiply(l);
        self.renderer.resetState();
        self.renderer.render(self.scene, self.camera);
        map.triggerRepaint();
      },
    };

    map.on("style.load", () => {
      if (this.map && !this.map.getLayer("jv-vehicle")) {
        try {
          this.map.addLayer(this.layer!);
        } catch {}
      }
    });
    try {
      map.addLayer(this.layer);
    } catch {}
  }

  setVehicle(kind: VehicleKind) {
    if (this.kind === kind && this.model) return;
    this.kind = kind;
    if (this.model) {
      this.scene.remove(this.model.group);
      disposeGroup(this.model.group);
    }
    this.model = buildVehicle(kind);
    this.scene.add(this.model.group);
    if (this.map && this.layer && !this.map.getLayer("jv-vehicle")) {
      try {
        this.map.addLayer(this.layer);
      } catch {}
    }
  }

  setPose(pose: VehiclePose, dtSec: number) {
    this.pose = pose;
    const model = this.model;
    if (!model) return;
    model.group.visible = pose.visible;
    if (!pose.visible) return;

    model.group.position.set(0, 0, 0);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, THREE.MathUtils.degToRad(-pose.bearing));
    const qPitch = new THREE.Quaternion().setFromAxisAngle(AXIS_X, THREE.MathUtils.degToRad(pose.pitch));
    const qBank = new THREE.Quaternion().setFromAxisAngle(AXIS_Z, THREE.MathUtils.degToRad(pose.bank));
    model.group.quaternion.copy(qYaw).multiply(qPitch).multiply(qBank);

    this.animPhase += dtSec * (2 + pose.speed * 0.55);
    for (const w of model.wheels) w.rotation.x += pose.speed * dtSec / 0.35;
    const walk = model.group.userData.walkParts as
      | { legs: THREE.Object3D[]; arms: THREE.Object3D[] }
      | undefined;
    if (walk) {
      walk.legs[0].rotation.x = Math.sin(this.animPhase * 2.2) * 0.55;
      walk.legs[1].rotation.x = -Math.sin(this.animPhase * 2.2) * 0.55;
      walk.arms[0].rotation.x = 0.2 - Math.sin(this.animPhase * 2.2) * 0.4;
      walk.arms[1].rotation.x = 0.2 + Math.sin(this.animPhase * 2.2) * 0.4;
      model.group.position.y = Math.abs(Math.sin(this.animPhase * 2.2)) * 0.05;
    }
  }

  detach() {
    if (this.layer && this.map && this.map.getLayer("jv-vehicle")) {
      this.map.removeLayer("jv-vehicle");
    }
  }
}

function mercatorModelMatrix(map: MlMap & { transform?: any }, pose: VehiclePose): THREE.Matrix4 {
  const mc = MercatorCoordinate.fromLngLat({ lng: pose.lng, lat: pose.lat }, 0);
  const scale = mc.meterInMercatorCoordinateUnits();
  let tz = mc.z;
  const tr = map.transform;
  if (map.terrain && tr && typeof tr.elevation === "number") {
    tz += (pose.elev - tr.elevation) * scale;
  } else {
    tz += pose.elev * scale;
  }
  return new THREE.Matrix4()
    .makeTranslation(mc.x, mc.y, tz)
    .scale(new THREE.Vector3(scale, -scale, scale))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
}

function globeModelMatrix(lng: number, lat: number, altitudeM: number): THREE.Matrix4 {
  const s = 1 / EARTH_RADIUS;
  return new THREE.Matrix4()
    .makeRotationY((lng / 180) * Math.PI)
    .multiply(new THREE.Matrix4().makeRotationX((-lat / 180) * Math.PI))
    .multiply(new THREE.Matrix4().makeTranslation(0, 0, 1 + altitudeM / EARTH_RADIUS))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    .multiply(new THREE.Matrix4().makeScale(s, s, s));
}

function disposeGroup(group: THREE.Group) {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}
