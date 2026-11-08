import * as THREE from 'three';
import { buildInstances } from '../core/instancing.js';

export const TRACK = {
  centerZ: 10,
  outerW: 46,
  outerH: 32,
  trackWidth: 7,
  cornerRadius: 9,
};

TRACK.innerW = TRACK.outerW - 2 * TRACK.trackWidth;
TRACK.innerH = TRACK.outerH - 2 * TRACK.trackWidth;
TRACK.midHalfW = TRACK.outerW * 0.5 - TRACK.trackWidth * 0.5;
TRACK.midHalfH = TRACK.outerH * 0.5 - TRACK.trackWidth * 0.5;
TRACK.midRadius = TRACK.cornerRadius - TRACK.trackWidth * 0.5;

function roundedRectShape(w, h, r) {
  const shape = new THREE.Shape();
  shape.moveTo(-w * 0.5 + r, -h * 0.5);
  shape.lineTo(w * 0.5 - r, -h * 0.5);
  shape.absarc(w * 0.5 - r, -h * 0.5 + r, r, -Math.PI * 0.5, 0, false);
  shape.lineTo(w * 0.5, h * 0.5 - r);
  shape.absarc(w * 0.5 - r, h * 0.5 - r, r, 0, Math.PI * 0.5, false);
  shape.lineTo(-w * 0.5 + r, h * 0.5);
  shape.absarc(-w * 0.5 + r, h * 0.5 - r, r, Math.PI * 0.5, Math.PI, false);
  shape.lineTo(-w * 0.5, -h * 0.5 + r);
  shape.absarc(-w * 0.5 + r, -h * 0.5 + r, r, Math.PI, Math.PI * 1.5, false);
  return shape;
}

function buildCenterlinePoints() {
  const points = [];
  const hW = TRACK.midHalfW;
  const hH = TRACK.midHalfH;
  const r = TRACK.midRadius;
  const centerZ = TRACK.centerZ;
  const straightSamples = 14;
  const arcSamples = 12;

  const pushStraight = (x0, z0, x1, z1) => {
    for (let i = 0; i <= straightSamples; i++) {
      const t = i / straightSamples;
      points.push(new THREE.Vector3(
        THREE.MathUtils.lerp(x0, x1, t),
        0,
        centerZ + THREE.MathUtils.lerp(z0, z1, t)
      ));
    }
  };
  const pushArc = (cx, cz, a0, a1) => {
    for (let i = 1; i <= arcSamples; i++) {
      const a = THREE.MathUtils.lerp(a0, a1, i / arcSamples);
      points.push(new THREE.Vector3(cx + Math.cos(a) * r, 0, centerZ + cz + Math.sin(a) * r));
    }
  };

  // Counter-clockwise: bottom straight → right side → top → left side
  pushStraight(-hW + r, -hH, hW - r, -hH);
  pushArc(hW - r, -hH + r, -Math.PI * 0.5, 0);
  pushStraight(hW, -hH + r, hW, hH - r);
  pushArc(hW - r, hH - r, 0, Math.PI * 0.5);
  pushStraight(hW - r, hH, -hW + r, hH);
  pushArc(-hW + r, hH - r, Math.PI * 0.5, Math.PI);
  pushStraight(-hW, hH - r, -hW, -hH + r);
  pushArc(-hW + r, -hH + r, Math.PI, Math.PI * 1.5);

  return points;
}

export function createTrackCurve() {
  return new THREE.CatmullRomCurve3(buildCenterlinePoints(), true, 'centripetal', 0.2);
}

/** True centre line — used for lap progress and the guardrail corridor. */
export function sampleCenterline(curve, count = 128) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const p = curve.getPointAt(i / count);
    out.push(new THREE.Vector3(p.x, 0, p.z));
  }
  return out;
}

/**
 * Weaving racing line for the AI, kept separate from the centre line.
 * Mixing the two (as before) made "distance from track" readings swing by ±0.5 m,
 * which is why the off-track cut detection was unreliable.
 */
export function buildRacingLine(curve, count = 96, roadWidth = TRACK.trackWidth) {
  const out = [];
  const tangent = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const u = i / count;
    const p = curve.getPointAt(u);
    curve.getTangentAt(u, tangent);
    const nx = -tangent.z;
    const nz = tangent.x;
    const offset = Math.sin(u * Math.PI * 2) * roadWidth * 0.08;
    out.push(new THREE.Vector3(p.x + nx * offset, 0, p.z + nz * offset));
  }
  return out;
}

const KERB = {
  width: 0.52,
  height: 0.09,
  /** Turn rate (rad per metre) above which a sample counts as "in a corner". */
  cornerThreshold: 0.04,
  /** Samples of lead-in / run-out added around each detected corner. */
  pad: 4,
  /** Target stripe length; the real length is rounded so the blocks tile exactly. */
  stripe: 0.8,
};

/**
 * Kerbs belong on corner apexes, not around the entire lap.
 *
 * The first version placed a 1.05 m block every 0.66 m along the *whole* track on both
 * sides: the blocks overlapped by 40 %, which is what made the red/white pattern look
 * noisy and irregular. This walks the curve, measures the turn rate, and emits blocks
 * only where the track actually bends — sized to tile edge-to-edge with no overlap.
 */
function buildKerbPlacements(curve) {
  const totalLength = curve.getLength();
  const samples = Math.max(8, Math.round(totalLength / KERB.stripe));
  const step = totalLength / samples;

  const tangent = new THREE.Vector3();
  const headings = new Float64Array(samples);
  const nodes = new Array(samples);

  for (let i = 0; i < samples; i++) {
    const u = i / samples;
    const point = curve.getPointAt(u);
    curve.getTangentAt(u, tangent);
    headings[i] = Math.atan2(tangent.x, tangent.z);
    // n = (-tz, tx) points to the *right* of travel.
    nodes[i] = { x: point.x, z: point.z, nx: -tangent.z, nz: tangent.x, rotationY: headings[i] };
  }

  // Signed turn rate per metre: ~0 on a straight, ±1/radius through an arc,
  // positive for a left-hand bend.
  const curvature = new Float64Array(samples);
  const inCorner = new Uint8Array(samples);
  for (let i = 0; i < samples; i++) {
    const next = (i + 1) % samples;
    let delta = headings[next] - headings[i];
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    curvature[i] = delta / step;
    if (Math.abs(curvature[i]) > KERB.cornerThreshold) inCorner[i] = 1;
  }

  // Dilate so the kerb starts just before turn-in and ends after the exit.
  const mask = new Uint8Array(samples);
  for (let i = 0; i < samples; i++) {
    if (!inCorner[i]) continue;
    for (let k = -KERB.pad; k <= KERB.pad; k++) mask[(i + k + samples) % samples] = 1;
  }

  // Sit the inner edge slightly under the tarmac so there is no grass seam.
  const offset = TRACK.trackWidth * 0.5 + KERB.width * 0.5 - 0.07;
  const kerbRed = [];
  const kerbWhite = [];

  for (let i = 0; i < samples; i++) {
    if (!mask[i]) continue;
    const node = nodes[i];
    for (const side of [-1, 1]) {
      // Blocks are spaced by arc length along the *centre* line, but the outside of a
      // bend is longer and the inside shorter — equal-length blocks therefore gap on
      // the outside and overlap on the inside. Scaling by the radius ratio
      // (1 + side·κ·offset) is exact for a circular arc and makes both edges tile.
      const lengthScale = Math.max(0.2, 1 + side * curvature[i] * offset);

      // The bevel sits on local +X, which maps to -normal. Rotating the right-hand
      // blocks by 180° points it at +normal instead, so both sides slope away from
      // the track. (A negative scale would mirror it too, but it flips the winding
      // order and the lighting with it.)
      const placement = {
        x: node.x + node.nx * side * offset,
        y: KERB.height * 0.5,
        z: node.z + node.nz * side * offset,
        rotationY: node.rotationY + (side > 0 ? Math.PI : 0),
        scale: { x: 1, y: 1, z: lengthScale },
      };
      (i % 2 === 0 ? kerbRed : kerbWhite).push(placement);
    }
  }

  return { kerbRed, kerbWhite, kerbLength: step };
}

/** Lowers the outer (+X) top edge of the kerb box so it ramps away from the track. */
function bevelKerbGeometry(geometry) {
  const position = geometry.attributes.position;
  const halfWidth = KERB.width * 0.5;
  const halfHeight = KERB.height * 0.5;
  for (let i = 0; i < position.count; i++) {
    if (position.getY(i) > 0 && position.getX(i) > halfWidth - 1e-4) {
      position.setY(i, -halfHeight + KERB.height * 0.35);
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

export function addTrackMesh(scene, curve, materials) {
  const group = new THREE.Group();
  group.name = 'track';

  // ── Tarmac ribbon (one shape with a hole, 1 draw call)
  const outer = roundedRectShape(TRACK.outerW, TRACK.outerH, TRACK.cornerRadius);
  const innerR = Math.max(2, TRACK.cornerRadius - TRACK.trackWidth);
  outer.holes.push(roundedRectShape(TRACK.innerW, TRACK.innerH, innerR));
  const roadGeom = new THREE.ShapeGeometry(outer, 48);
  roadGeom.rotateX(-Math.PI * 0.5);
  const road = new THREE.Mesh(roadGeom, materials.road);
  road.position.set(0, 0.012, TRACK.centerZ);
  road.receiveShadow = true;
  road.matrixAutoUpdate = false;
  road.updateMatrix();
  group.add(road);

  // ── Infield grass
  const islandGeom = new THREE.ShapeGeometry(
    roundedRectShape(TRACK.innerW - 0.35, TRACK.innerH - 0.35, Math.max(1.5, innerR - 0.2)),
    24
  );
  islandGeom.rotateX(-Math.PI * 0.5);
  const island = new THREE.Mesh(islandGeom, materials.grassInfield);
  island.position.set(0, 0.014, TRACK.centerZ);
  island.receiveShadow = true;
  island.matrixAutoUpdate = false;
  island.updateMatrix();
  group.add(island);

  // ── Centre dashes: 40 meshes → 1 InstancedMesh
  const dashPlacements = [];
  const dashCount = 120;
  const tangent = new THREE.Vector3();
  for (let i = 0; i < dashCount; i += 3) {
    const u = i / dashCount;
    const p = curve.getPointAt(u);
    curve.getTangentAt(u, tangent);
    dashPlacements.push({ x: p.x, y: 0.03, z: p.z, rotationY: Math.atan2(tangent.x, tangent.z) });
  }
  group.add(buildInstances(
    new THREE.BoxGeometry(0.18, 0.03, 1.2),
    materials.dash,
    dashPlacements,
    { name: 'dashes' }
  ));

  // ── Kerbs: only in the corners, tiled edge-to-edge
  const { kerbRed, kerbWhite, kerbLength } = buildKerbPlacements(curve);
  const kerbGeom = new THREE.BoxGeometry(KERB.width, KERB.height, kerbLength);
  // Bevel the outer edge down so the kerb reads as a ramp, not a floating slab.
  bevelKerbGeometry(kerbGeom);
  group.add(buildInstances(kerbGeom, materials.kerbRed, kerbRed, { name: 'kerb-red' }));
  group.add(buildInstances(kerbGeom, materials.kerbWhite, kerbWhite, { name: 'kerb-white' }));

  // ── Start / finish chequer
  const finishU = 0.02;
  const finishP = curve.getPointAt(finishU);
  const finishT = curve.getTangentAt(finishU).normalize();
  const finishN = new THREE.Vector3(-finishT.z, 0, finishT.x).normalize();
  const tileW = TRACK.trackWidth / 10;
  const rotationY = Math.atan2(finishT.x, finishT.z);
  const tilesA = [];
  const tilesB = [];
  for (let i = 0; i < 10; i++) {
    const d = -TRACK.trackWidth * 0.5 + tileW * (i + 0.5);
    const placement = {
      x: finishP.x + finishN.x * d,
      y: 0.035,
      z: finishP.z + finishN.z * d,
      rotationY,
    };
    (i % 2 === 0 ? tilesA : tilesB).push(placement);
  }
  const tileGeom = new THREE.BoxGeometry(tileW, 0.035, 0.5);
  group.add(buildInstances(tileGeom, materials.finishLight, tilesA, { name: 'finish-light' }));
  group.add(buildInstances(tileGeom, materials.finishDark, tilesB, { name: 'finish-dark' }));

  scene.add(group);

  return {
    roadWidth: TRACK.trackWidth,
    finishLine: {
      center: finishP.clone().setY(0),
      tangent: finishT.clone(),
      normal: finishN.clone(),
      halfWidth: TRACK.trackWidth * 0.5,
    },
  };
}

/**
 * Guardrails: 252 individual meshes (each with its *own* freshly allocated
 * BoxGeometry) collapsed into 2 InstancedMesh draw calls.
 */
export function addGuardrails(scene, curve, roadWidth, materials) {
  const railPlacements = [];
  const postPlacements = [];
  const offset = roadWidth * 0.5 + 1.35;
  const segmentCount = 84;
  const tangent = new THREE.Vector3();

  for (let i = 0; i < segmentCount; i++) {
    const u = i / segmentCount;
    const p = curve.getPointAt(u);
    curve.getTangentAt(u, tangent);
    const nx = -tangent.z;
    const nz = tangent.x;
    const rotationY = Math.atan2(tangent.x, tangent.z);
    for (const side of [-1, 1]) {
      const bx = p.x + nx * side * offset;
      const bz = p.z + nz * side * offset;
      railPlacements.push({ x: bx, y: 0.52, z: bz, rotationY });
      if (i % 2 === 0) postPlacements.push({ x: bx, y: 0.21, z: bz, rotationY });
    }
  }

  const group = new THREE.Group();
  group.name = 'guardrails';
  group.add(buildInstances(
    new THREE.BoxGeometry(0.12, 0.16, 1.4),
    materials.rail,
    railPlacements,
    { name: 'rails', castShadow: true }
  ));
  group.add(buildInstances(
    new THREE.BoxGeometry(0.1, 0.42, 0.1),
    materials.post,
    postPlacements,
    { name: 'posts' }
  ));
  scene.add(group);
  return group;
}
