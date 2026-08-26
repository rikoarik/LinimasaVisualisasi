import * as THREE from "three";
import type { VehicleKind } from "../journey/types";

const M = {
  body: new THREE.MeshLambertMaterial({ color: 0xd8dde6, emissive: 0x1c1f24 }),
  dark: new THREE.MeshLambertMaterial({ color: 0x22262e }),
  accent: new THREE.MeshLambertMaterial({ color: 0xe0492f, emissive: 0x5a1408 }),
  glass: new THREE.MeshLambertMaterial({ color: 0x8fb7d9, transparent: true, opacity: 0.85 }),
  tire: new THREE.MeshLambertMaterial({ color: 0x14161a }),
  metal: new THREE.MeshLambertMaterial({ color: 0x9aa3b0 }),
  skin: new THREE.MeshLambertMaterial({ color: 0xd9a066 }),
  shirt: new THREE.MeshLambertMaterial({ color: 0x2f6fed, emissive: 0x0a1c4d }),
  pants: new THREE.MeshLambertMaterial({ color: 0x2b2f38 }),
};

export interface VehicleModel {
  group: THREE.Group;
  wheels: THREE.Object3D[];
  lengthMeters: number;
  displayScale: number;
}

function box(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  return m;
}

function cyl(r: number, h: number, mat: THREE.Material, seg = 14): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
}

function wheel(r: number, w: number): THREE.Group {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 16), M.tire);
  tire.rotation.z = Math.PI / 2;
  g.add(tire);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, w + 0.02, 10), M.metal);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  return g;
}

function buildCar(): VehicleModel {
  const g = new THREE.Group();
  const body = box(1.8, 0.55, 4.4, M.accent);
  body.position.y = 0.62;
  g.add(body);
  const cabin = box(1.55, 0.5, 2.1, M.glass);
  cabin.position.set(0, 1.12, -0.15);
  g.add(cabin);
  const roof = box(1.45, 0.08, 1.7, M.accent);
  roof.position.set(0, 1.4, -0.15);
  g.add(roof);
  const nose = box(1.75, 0.32, 0.5, M.dark);
  nose.position.set(0, 0.48, -2.35);
  g.add(nose);
  for (const sx of [-0.62, 0.62]) {
    const hl = box(0.34, 0.12, 0.06, new THREE.MeshBasicMaterial({ color: 0xfff2c4 }));
    hl.position.set(sx, 0.72, -2.22);
    g.add(hl);
    const tl = box(0.34, 0.12, 0.06, new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    tl.position.set(sx, 0.72, 2.22);
    g.add(tl);
  }
  const wheels: THREE.Object3D[] = [];
  for (const [sx, sz] of [
    [-0.86, -1.42],
    [0.86, -1.42],
    [-0.86, 1.42],
    [0.86, 1.42],
  ]) {
    const w = wheel(0.36, 0.26);
    w.position.set(sx, 0.36, sz);
    g.add(w);
    wheels.push(w);
  }
  return { group: g, wheels, lengthMeters: 4.6, displayScale: 8 };
}

function buildBus(): VehicleModel {
  const g = new THREE.Group();
  const body = box(2.4, 2.2, 10.5, M.body);
  body.position.y = 1.5;
  g.add(body);
  const stripe = box(2.44, 0.5, 10.54, M.accent);
  stripe.position.y = 1.1;
  g.add(stripe);
  const winStripF = box(2.42, 0.7, 9.6, M.glass);
  winStripF.position.set(0, 2.05, -0.2);
  g.add(winStripF);
  const windshield = box(2.2, 1.1, 0.08, M.glass);
  windshield.position.set(0, 1.9, -5.28);
  g.add(windshield);
  const wheels: THREE.Object3D[] = [];
  for (const sz of [-3.6, 3.4]) {
    for (const sx of [-1.15, 1.15]) {
      const w = wheel(0.55, 0.36);
      w.position.set(sx, 0.55, sz);
      g.add(w);
      wheels.push(w);
    }
  }
  return { group: g, wheels, lengthMeters: 11, displayScale: 4.5 };
}

function buildTrain(): VehicleModel {
  const g = new THREE.Group();
  const loco = new THREE.Group();
  const body = box(2.8, 2.6, 13, M.body);
  body.position.y = 2;
  loco.add(body);
  const noseGeo = new THREE.CylinderGeometry(1.4, 1.4, 3.2, 12, 1, false, 0, Math.PI);
  noseGeo.rotateX(Math.PI / 2);
  noseGeo.rotateY(Math.PI);
  const nose = new THREE.Mesh(noseGeo, M.accent);
  nose.position.set(0, 2, -6.5);
  loco.add(nose);
  const winStrip = box(2.84, 0.8, 10.5, M.glass);
  winStrip.position.set(0, 2.7, 0.4);
  loco.add(winStrip);
  const skirt = box(2.6, 0.8, 12.6, M.dark);
  skirt.position.y = 0.75;
  loco.add(skirt);
  g.add(loco);
  const wheels: THREE.Object3D[] = [];
  for (const sz of [-4.6, 4.6]) {
    for (const sx of [-1.25, 1.25]) {
      const w = wheel(0.5, 0.3);
      w.position.set(sx, 0.5, sz);
      g.add(w);
      wheels.push(w);
    }
  }
  return { group: g, wheels, lengthMeters: 14, displayScale: 4 };
}

function buildMotorcycle(): VehicleModel {
  const g = new THREE.Group();
  const frame = box(0.34, 0.3, 1.5, M.dark);
  frame.position.y = 0.62;
  g.add(frame);
  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), M.accent);
  tank.scale.set(1, 0.7, 1.7);
  tank.position.set(0, 0.88, -0.28);
  g.add(tank);
  const seat = box(0.3, 0.12, 0.62, M.dark);
  seat.position.set(0, 0.86, 0.42);
  g.add(seat);
  const bars = box(0.62, 0.05, 0.05, M.metal);
  bars.position.set(0, 1.18, -0.62);
  g.add(bars);
  const fork = cyl(0.045, 0.62, M.metal, 8);
  fork.rotation.x = Math.PI / 2.6;
  fork.position.set(0, 0.72, -0.72);
  g.add(fork);

  const rider = new THREE.Group();
  const torso = box(0.4, 0.52, 0.28, M.shirt);
  torso.position.set(0, 1.28, 0.16);
  rider.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }));
  head.position.set(0, 1.66, 0.02);
  rider.add(head);
  const visor = box(0.2, 0.09, 0.02, M.glass);
  visor.position.set(0, 1.66, -0.13);
  rider.add(visor);
  for (const sx of [-0.24, 0.24]) {
    const arm = box(0.1, 0.1, 0.56, M.shirt);
    arm.position.set(sx, 1.24, -0.18);
    arm.rotation.x = -0.5;
    rider.add(arm);
    const legU = box(0.13, 0.42, 0.14, M.pants);
    legU.position.set(sx, 0.82, 0.34);
    legU.rotation.x = 0.35;
    rider.add(legU);
    const legL = box(0.12, 0.4, 0.13, M.pants);
    legL.position.set(sx, 0.46, 0.46);
    rider.add(legL);
  }
  g.add(rider);

  const wheels: THREE.Object3D[] = [];
  for (const sz of [-0.78, 0.78]) {
    const w = wheel(0.31, 0.12);
    w.position.set(0, 0.31, sz);
    g.add(w);
    wheels.push(w);
  }
  const hl = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2c4 }));
  hl.position.set(0, 1.02, -0.92);
  g.add(hl);
  return { group: g, wheels, lengthMeters: 2.2, displayScale: 12 };
}

function buildBicycle(): VehicleModel {
  const g = new THREE.Group();
  const frameMat = M.accent;
  const tube = (from: [number, number, number], to: [number, number, number], r = 0.025) => {
    const dir = new THREE.Vector3(...to).sub(new THREE.Vector3(...from));
    const len = dir.length();
    const t = cyl(r, len, frameMat, 8);
    t.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
    t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    g.add(t);
  };
  tube([0, 0.98, -0.62], [0, 0.62, 0]);
  tube([0, 0.62, 0], [0, 0.95, 0.62]);
  tube([0, 0.98, -0.62], [0, 0.95, 0.62]);
  tube([0, 0.62, 0], [0, 0.98, -0.62]);
  tube([0, 1.12, -0.58], [0, 1.0, -0.66]);

  const rider = new THREE.Group();
  const torso = box(0.32, 0.5, 0.2, M.shirt);
  torso.position.set(0, 1.32, 0.05);
  torso.rotation.x = 0.55;
  rider.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), M.skin);
  head.position.set(0, 1.62, -0.18);
  rider.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.accent);
  helmet.position.copy(head.position);
  rider.add(helmet);
  for (const sx of [-0.17, 0.17]) {
    const arm = box(0.07, 0.07, 0.5, M.skin);
    arm.position.set(sx, 1.3, -0.3);
    arm.rotation.x = 0.65;
    rider.add(arm);
    const leg = box(0.1, 0.5, 0.11, M.pants);
    leg.position.set(sx, 0.86, 0.28);
    rider.add(leg);
  }
  g.add(rider);

  const wheels: THREE.Object3D[] = [];
  for (const sz of [-0.64, 0.64]) {
    const w = wheel(0.33, 0.05);
    w.position.set(0, 0.33, sz);
    g.add(w);
    wheels.push(w);
  }
  return { group: g, wheels, lengthMeters: 1.8, displayScale: 11 };
}

function buildWalker(): VehicleModel {
  const g = new THREE.Group();
  const torso = box(0.34, 0.55, 0.2, M.shirt);
  torso.position.y = 1.05;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), M.skin);
  head.position.y = 1.5;
  g.add(head);
  const legs: THREE.Object3D[] = [];
  for (const sx of [-0.09, 0.09]) {
    const leg = box(0.12, 0.78, 0.13, M.pants);
    leg.geometry.translate(0, -0.39, 0);
    leg.position.set(sx, 0.78, 0);
    g.add(leg);
    legs.push(leg);
  }
  const arms: THREE.Object3D[] = [];
  for (const sx of [-0.24, 0.24]) {
    const arm = box(0.09, 0.6, 0.1, M.shirt);
    arm.geometry.translate(0, -0.3, 0);
    arm.position.set(sx, 1.3, 0);
    arm.rotation.x = 0.2;
    g.add(arm);
    arms.push(arm);
  }
  g.userData.walkParts = { legs, arms };
  return { group: g, wheels: [], lengthMeters: 0.7, displayScale: 14 };
}

function buildAirplane(): VehicleModel {
  const g = new THREE.Group();
  const fuselage = cyl(1.1, 16, M.body, 18);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.position.y = 2.2;
  g.add(fuselage);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12), M.body);
  nose.position.set(0, 2.2, -8);
  g.add(nose);
  const cockpitBand = cyl(1.12, 1.6, M.dark, 18);
  cockpitBand.rotation.x = Math.PI / 2;
  cockpitBand.position.set(0, 2.35, -7.2);
  g.add(cockpitBand);

  for (const side of [1, -1]) {
    const wing = box(11.5, 0.26, 3.4, M.body);
    wing.position.set(side * 6.4, 2.0, -0.4);
    wing.rotation.y = side > 0 ? -0.42 : 0.42;
    g.add(wing);
  }

  const tailFin = box(0.26, 2.6, 2.4, M.accent);
  tailFin.position.set(0, 4.1, 6.6);
  tailFin.rotation.x = 0.35;
  g.add(tailFin);
  for (const side of [-1, 1]) {
    const stab = box(3.4, 0.2, 1.4, M.body);
    stab.position.set(side * 2.1, 3.1, 7.0);
    g.add(stab);
  }
  for (const [sx, sz] of [
    [-3.4, -1.4],
    [3.4, -1.4],
  ]) {
    const engine = cyl(0.62, 2.0, M.metal, 12);
    engine.rotation.x = Math.PI / 2;
    engine.position.set(sx, 1.35, sz - 0.6);
    g.add(engine);
    const intake = new THREE.Mesh(new THREE.CircleGeometry(0.6, 12), M.dark);
    intake.position.set(sx, 1.35, sz - 1.62);
    g.add(intake);
  }
  return { group: g, wheels: [], lengthMeters: 17, displayScale: 3 };
}

export function buildVehicle(kind: VehicleKind): VehicleModel {
  switch (kind) {
    case "car":
      return buildCar();
    case "bus":
      return buildBus();
    case "train":
      return buildTrain();
    case "motorcycle":
      return buildMotorcycle();
    case "bicycle":
      return buildBicycle();
    case "walking":
      return buildWalker();
    case "airplane":
      return buildAirplane();
  }
}
