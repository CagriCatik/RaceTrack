import * as THREE from 'three';

const TRACK = {
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
      points.push(
        new THREE.Vector3(
          THREE.MathUtils.lerp(x0, x1, t),
          0,
          centerZ + THREE.MathUtils.lerp(z0, z1, t)
        )
      );
    }
  };

  const pushArc = (cx, cz, a0, a1) => {
    for (let i = 1; i <= arcSamples; i++) {
      const t = i / arcSamples;
      const a = THREE.MathUtils.lerp(a0, a1, t);
      points.push(new THREE.Vector3(cx + Math.cos(a) * r, 0, centerZ + cz + Math.sin(a) * r));
    }
  };

  // Counter-clockwise loop: bottom straight -> right side -> top -> left side
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

export function addTrackMesh(scene, curve) {
  const outer = roundedRectShape(TRACK.outerW, TRACK.outerH, TRACK.cornerRadius);
  const innerR = Math.max(2, TRACK.cornerRadius - TRACK.trackWidth);
  outer.holes.push(roundedRectShape(TRACK.innerW, TRACK.innerH, innerR));

  const roadGeom = new THREE.ShapeGeometry(outer, 64);
  roadGeom.rotateX(-Math.PI * 0.5);
  const road = new THREE.Mesh(
    roadGeom,
    new THREE.MeshStandardMaterial({
      color: 0x252525,
      roughness: 0.58,
      metalness: 0.05,
      side: THREE.DoubleSide,
    })
  );
  road.position.set(0, 0.012, TRACK.centerZ);
  road.receiveShadow = true;
  scene.add(road);

  const islandShape = roundedRectShape(TRACK.innerW - 0.35, TRACK.innerH - 0.35, Math.max(1.5, innerR - 0.2));
  const islandGeom = new THREE.ShapeGeometry(islandShape, 32);
  islandGeom.rotateX(-Math.PI * 0.5);
  const island = new THREE.Mesh(
    islandGeom,
    new THREE.MeshStandardMaterial({ color: 0x4d6b39, roughness: 0.95, metalness: 0 })
  );
  island.position.set(0, 0.014, TRACK.centerZ);
  island.receiveShadow = true;
  scene.add(island);

  const dashMat = new THREE.MeshStandardMaterial({ color: 0xe0b01c, roughness: 0.35 });
  const dashCount = 120;
  for (let i = 0; i < dashCount; i += 3) {
    const u = i / dashCount;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 1.2), dashMat);
    dash.position.set(p.x, 0.03, p.z);
    dash.rotation.y = Math.atan2(t.x, t.z);
    dash.receiveShadow = true;
    scene.add(dash);
  }

  const finishMatA = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
  const finishMatB = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.35 });
  const finishU = 0.02;
  const finishP = curve.getPointAt(finishU);
  const finishT = curve.getTangentAt(finishU);
  const finishN = new THREE.Vector3(-finishT.z, 0, finishT.x).normalize();
  const tileW = TRACK.trackWidth / 10;
  for (let i = 0; i < 10; i++) {
    const tile = new THREE.Mesh(
      new THREE.BoxGeometry(tileW, 0.035, 0.45),
      i % 2 === 0 ? finishMatA : finishMatB
    );
    tile.position.copy(finishP).addScaledVector(finishN, -TRACK.trackWidth * 0.5 + tileW * (i + 0.5));
    tile.position.y = 0.035;
    tile.rotation.y = Math.atan2(finishT.x, finishT.z);
    scene.add(tile);
  }

  const finishLine = {
    center: finishP.clone().setY(0),
    tangent: finishT.clone().normalize(),
    normal: finishN.clone().normalize(),
    halfWidth: TRACK.trackWidth * 0.5,
  };

  return { roadWidth: TRACK.trackWidth, trackSegments: 240, finishLine };
}

export function addGuardrails(scene, curve, roadWidth) {
  const railMat = new THREE.MeshStandardMaterial({ color: 0x6f757d, roughness: 0.55, metalness: 0.4 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x585d64, roughness: 0.65, metalness: 0.2 });
  const offset = roadWidth * 0.5 + 1.35;

  const segmentCount = 84;
  for (let i = 0; i < segmentCount; i++) {
    const u = i / segmentCount;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const n = new THREE.Vector3(-t.z, 0, t.x).normalize();
    const heading = Math.atan2(t.x, t.z);

    for (const side of [-1, 1]) {
      const base = p.clone().addScaledVector(n, side * offset);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 1.35), railMat);
      rail.position.set(base.x, 0.52, base.z);
      rail.rotation.y = heading;
      rail.receiveShadow = true;
      scene.add(rail);

      if (i % 2 === 0) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.08), postMat);
        post.position.set(base.x, 0.21, base.z);
        post.receiveShadow = true;
        scene.add(post);
      }
    }
  }
}
