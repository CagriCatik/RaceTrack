import * as THREE from 'three';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js';
import { mergeVehicleConfig, vehicleConfig as defaultVehicleConfig } from './config/vehicleConfig.js';

// ─── Math helpers ─────────────────────────────────────────────────────────────

/** Frame-rate-independent exponential smoothing: feels the same at any fps */
const expLerp = (a, b, halfLife, dt) =>
  b + (a - b) * Math.exp(-Math.LN2 / Math.max(halfLife, 1e-4) * dt);

/** Clamp a value to [-limit, limit] */
const clampAbs = (v, limit) => THREE.MathUtils.clamp(v, -limit, limit);

/** Numeric quantile with clamped [0, 1] input */
const quantile = (values, q) => {
  if (!values.length) return 0;
  if (values.length === 1) return values[0];
  const sorted = [...values].sort((a, b) => a - b);
  const t = THREE.MathUtils.clamp(q, 0, 1) * (sorted.length - 1);
  const i0 = Math.floor(t);
  const i1 = Math.min(sorted.length - 1, i0 + 1);
  const f = t - i0;
  return sorted[i0] * (1 - f) + sorted[i1] * f;
};

// ─── Spoke rim builder ────────────────────────────────────────────────────────

function buildRim(radius, width, spokeCount = 6) {
  const group = new THREE.Group();
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd4d4d4, metalness: 0.75, roughness: 0.18 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.3, roughness: 0.6 });

  // Hub centre disc
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.12, radius * 0.12, width + 0.02, 16),
    rimMat
  );
  hub.rotation.z = Math.PI / 2;
  group.add(hub);

  // Outer barrel ring
  const barrel = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.82, radius * 0.055, 10, 36),
    rimMat
  );
  barrel.rotation.y = Math.PI / 2;
  group.add(barrel);

  // Centre face disc (fills gap between spokes)
  const face = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.80, radius * 0.80, width * 0.25, 32),
    darkMat
  );
  face.rotation.z = Math.PI / 2;
  group.add(face);

  // Spokes
  const spokeLen = radius * 0.72;
  const spokeGeom = new THREE.BoxGeometry(width * 0.5, radius * 0.08, spokeLen);
  for (let i = 0; i < spokeCount; i++) {
    const angle = (i / spokeCount) * Math.PI * 2;
    const spoke = new THREE.Mesh(spokeGeom, rimMat);
    spoke.rotation.x = angle;
    spoke.position.set(0, Math.sin(angle) * spokeLen * 0.5, Math.cos(angle) * spokeLen * 0.5);
    group.add(spoke);
  }

  return group;
}

// ─── Tyre builder (tread lines on sidewall) ───────────────────────────────────

function buildTyre(radius, width) {
  const group = new THREE.Group();
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.75, metalness: 0 });
  const treadMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });

  // Main tyre cylinder
  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, 32),
    tireMat
  );
  tyre.rotation.z = Math.PI / 2;
  group.add(tyre);

  // Sidewall tread stripes (thin rings)
  const ringGeom = new THREE.TorusGeometry(radius * 0.93, radius * 0.025, 6, 32);
  [-width * 0.28, width * 0.28].forEach((xOff) => {
    const ring = new THREE.Mesh(ringGeom, treadMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = xOff;
    group.add(ring);
  });

  return group;
}

// ─── Wheel assembly (tyre + rim + pivot) ─────────────────────────────────────

function buildWheelAssembly(radius, width) {
  const pivot = new THREE.Group(); // steerable pivot
  const spinGroup = new THREE.Group(); // spins with car speed
  pivot.add(spinGroup);

  const tyre = buildTyre(radius, width);
  tyre.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  spinGroup.add(tyre);

  const rim = buildRim(radius, width);
  rim.traverse((c) => { if (c.isMesh) c.castShadow = true; });
  spinGroup.add(rim);

  return { pivot, spinGroup };
}

// ─── Vehicle ──────────────────────────────────────────────────────────────────

export default class Vehicle {
  constructor(position = new THREE.Vector3(0, 0, 0), options = {}) {
    this.config = mergeVehicleConfig(defaultVehicleConfig, options);
    const { geometry, dynamics, suspension, lights, model } = this.config;

    // ── Geometry
    this.wheelBase   = geometry.wheelBase;   // front-to-rear axle distance
    this.trackWidth  = geometry.trackWidth;  // lateral wheel centre distance
    this.wheelRadius = geometry.wheelRadius;
    this.wheelWidth  = geometry.wheelWidth;
    this.cg_height   = geometry.cgHeight;    // centre-of-gravity height (for roll calc)

    // ── Dynamics state
    this.speed       = 0;      // m/s along forward axis (+Z = forward)
    this.heading     = 0;      // world yaw (radians)
    this.steerInput  = 0;      // accumulated [-1, 1]
    this.steerAngle  = 0;      // front wheel steer (rad)
    this.slipAngle   = 0;      // body slip (rad) — for drift feel
    this.yawRate     = 0;      // current yaw rate (rad/s)

    // ── Tuning
    this.maxSpeed      = dynamics.maxSpeed;                            // m/s (~65 km/h)
    this.reverseSpeed  = dynamics.reverseSpeed;
    this.accelRate     = dynamics.accelRate;                            // m/s² throttle
    this.engineBrake   = dynamics.engineBrake;                           // coast decel
    this.brakeRate     = dynamics.brakeRate;                            // hard brake
    this.rollingDrag   = dynamics.rollingDrag;                          // speed-proportional drag
    this.maxSteerDeg   = dynamics.maxSteerDeg;
    this.maxSteer      = THREE.MathUtils.degToRad(this.maxSteerDeg);
    this.steerSpeed    = dynamics.steerSpeed;                           // build rate (rad/s of input)
    this.steerReturnHL = dynamics.steerReturnHalfLife;                          // half-life for self-centre
    this.gripLimit     = dynamics.gripLimit;                            // m/s² lateral grip
    this.slipFactor    = dynamics.slipFactor;                          // how much slip resists heading

    // ── Suspension
    this.suspK          = suspension.spring;    // spring constant visual (multiplied by compression)
    this.suspDamp       = suspension.dampingHalfLife;  // damping half-life (s)
    this.suspRange      = suspension.travel;  // max travel (m)
    this._suspComp      = { fl: 0, fr: 0, rl: 0, rr: 0 }; // current compression
    this._suspVel       = { fl: 0, fr: 0, rl: 0, rr: 0 }; // compression velocity

    // ── Internal state
    this._prevSpeed    = 0;
    this._longAcc      = 0;
    this._latAcc       = 0;
    this._bodyRoll     = 0;
    this._bodyPitch    = 0;
    this._wheelSpin    = 0;
    this._skidding     = false;
    this._braking      = false;

    // ── Scene graph
    this.group      = new THREE.Group();
    this.group.position.copy(position);
    this.bodyPivot  = new THREE.Group(); // roll / pitch pivot
    this.group.add(this.bodyPivot);

    this._placeholders = [];
    this._headlights   = [];
    this._tailLamps    = [];
    this._brakeLamps   = [];
    this._headlightTargets = [];
    this._headlightBeams = [];
    this._frontFills = [];
    this._tailGlows = [];
    this._wheels = {};
    this._exhaustWorldSpace = false;
    this._placeholderBuilt = false;
    this.lightMountTuning = {
      frontX: lights.tuning.frontX,
      frontY: lights.tuning.frontY,
      frontZ: lights.tuning.frontZ,
      rearX: lights.tuning.rearX,
      rearY: lights.tuning.rearY,
      rearZ: lights.tuning.rearZ,
    };
    this.modelPath = model.path;
    this._lightFit = null;
    this._lightSystemEnabled = true;

    this._buildWheels();
    this._buildLights();
    this._buildExhaust();
    this._loadModel();
  }

  // ── Placeholder body (shown before GLTF loads) ──────────────────────────────

  _buildPlaceholder() {
    if (this._placeholderBuilt) return;
    this._placeholderBuilt = true;

    const bodyMat  = new THREE.MeshStandardMaterial({ color: 0x1f66c2, metalness: 0.3, roughness: 0.3 });
    const trimMat  = new THREE.MeshStandardMaterial({ color: 0x0c0f16, metalness: 0.2, roughness: 0.45 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2636, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.65 });
    const rimAccent = new THREE.MeshStandardMaterial({ color: 0x2255cc, metalness: 0.1, roughness: 0.6 });

    const add = (geom, mat, x, y, z, ry = 0) => {
      const m = new THREE.Mesh(geom, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.position.set(x, y, z);
      m.rotation.y = ry;
      this.bodyPivot.add(m);
      this._placeholders.push(m);
      return m;
    };

    // Lower hull — slightly tapered look with two layers
    add(new THREE.BoxGeometry(2.02, 0.30, 4.0),  bodyMat,  0, 0.38, 0);
    add(new THREE.BoxGeometry(1.90, 0.22, 3.75), rimAccent, 0, 0.55, 0); // mid-belt line

    // Hood / bonnet — angled by scaling
    const hoodGeom = new THREE.BoxGeometry(1.82, 0.18, 1.4);
    add(hoodGeom, bodyMat, 0, 0.72, 1.05);

    // Roof
    add(new THREE.BoxGeometry(1.34, 0.14, 1.52), glassMat,  0, 1.14, -0.05);

    // A-pillar pillars
    [[-0.55, 0.98, 0.72], [0.55, 0.98, 0.72]].forEach(([x, y, z]) => {
      add(new THREE.BoxGeometry(0.06, 0.38, 0.06), trimMat, x, y, z);
    });

    // Cabin glass
    add(new THREE.BoxGeometry(1.36, 0.52, 1.62), glassMat, 0, 0.96, -0.05);

    // Front bumper
    add(new THREE.BoxGeometry(2.10, 0.22, 0.26), trimMat, 0, 0.30, 2.06);
    add(new THREE.BoxGeometry(2.06, 0.08, 0.12), rimAccent, 0, 0.22, 2.08); // lower lip

    // Rear bumper + diffuser
    add(new THREE.BoxGeometry(2.10, 0.22, 0.26), trimMat, 0, 0.30, -2.06);
    add(new THREE.BoxGeometry(1.40, 0.10, 0.10), trimMat, 0, 0.18, -2.10); // diffuser

    // Side skirts
    [-1.04, 1.04].forEach((x) => {
      add(new THREE.BoxGeometry(0.07, 0.18, 3.65), trimMat, x, 0.28, 0);
    });

    // Spoiler blade
    add(new THREE.BoxGeometry(1.60, 0.08, 0.30), trimMat,  0, 0.85, -2.02);
    add(new THREE.BoxGeometry(0.07, 0.25, 0.07), trimMat, -0.65, 0.74, -2.02);
    add(new THREE.BoxGeometry(0.07, 0.25, 0.07), trimMat,  0.65, 0.74, -2.02);
  }

  // ── Wheel assemblies ────────────────────────────────────────────────────────

  _buildWheels() {
    const r  = this.wheelRadius;
    const w  = this.wheelWidth;
    const wb = this.wheelBase;
    const tw = this.trackWidth;

    // Correct axle positions: front axle ~55% forward, rear axle ~55% back
    const zF =  wb * 0.50;
    const zR = -wb * 0.50;
    const xL = -tw / 2;
    const xR =  tw / 2;

    const positions = {
      fl: [xL, zF, true ],
      fr: [xR, zF, true ],
      rl: [xL, zR, false],
      rr: [xR, zR, false],
    };

    Object.entries(positions).forEach(([key, [x, z, steerable]]) => {
      const { pivot, spinGroup } = buildWheelAssembly(r, w);
      pivot.position.set(x, r, z);
      this.group.add(pivot);
      this._wheels[key] = { pivot, spinGroup, steerable, baseY: r };
    });
  }

  // ── Lighting ────────────────────────────────────────────────────────────────

  _buildLights() {
    // Headlight lens meshes
    const headLensMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xfff5cc, emissiveIntensity: 7.2,
      roughness: 0.05, metalness: 0.1,
    });
    // DRL strip (thin bar below headlight)
    const drlMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 8,
      roughness: 0.05,
    });
    // Tail / brake
    const tailMat = new THREE.MeshStandardMaterial({
      color: 0x660000, emissive: 0xcc0000, emissiveIntensity: 2.4,
      roughness: 0.3,
    });
    const brakeMat = new THREE.MeshStandardMaterial({
      color: 0xff0000, emissive: 0xff2200, emissiveIntensity: 6.0,
      roughness: 0.2,
    });

    [-0.55, 0.55].forEach((x, i) => {
      // ── Front: lens + DRL
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.12, 0.06), headLensMat.clone());
      lens.userData.onEmissiveIntensity = lens.material.emissiveIntensity;
      lens.position.set(x, 0.62, 2.10);
      this.bodyPivot.add(lens);
      this._headlights.push(lens);

      const drl = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.05), drlMat.clone());
      drl.position.set(x, 0.48, 2.10);
      this.bodyPivot.add(drl);
      this._placeholders.push(drl);

      // Headlight beam (SpotLight)
      const target = new THREE.Object3D();
      target.position.set(x * 0.7, 0.1, 18);
      this.bodyPivot.add(target);
      this._headlightTargets.push(target);

      const beam = new THREE.SpotLight(0xfff7d0, 5.4, 85, THREE.MathUtils.degToRad(24), 0.32, 1.05);
      beam.userData.onIntensity = beam.intensity;
      beam.position.set(x, 0.6, 2.15);
      beam.target = target;
      beam.castShadow = false;
      this.bodyPivot.add(beam);
      this._headlightBeams.push(beam);

      // Small front point fill
      const frontFill = new THREE.PointLight(0xfff5aa, 1.8, 16, 2);
      frontFill.userData.onIntensity = frontFill.intensity;
      frontFill.position.set(x, 0.55, 2.5);
      this.bodyPivot.add(frontFill);
      this._frontFills.push(frontFill);

      // ── Rear: tail + brake (separate meshes, same position, different materials)
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.07), tailMat.clone());
      tail.userData.onEmissiveIntensity = tail.material.emissiveIntensity;
      tail.position.set(x, 0.52, -2.10);
      this.bodyPivot.add(tail);
      this._tailLamps.push(tail);

      const brake = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.10, 0.08), brakeMat.clone());
      brake.position.set(x, 0.52, -2.10);
      brake.visible = false; // shown only when braking
      this.bodyPivot.add(brake);
      this._brakeLamps.push(brake);

      // Tail glow light
      const tailGlow = new THREE.PointLight(0xff2200, 0.8, 8, 2);
      tailGlow.userData.onIntensity = tailGlow.intensity;
      tailGlow.position.set(x, 0.48, -2.18);
      this.bodyPivot.add(tailGlow);
      this._tailGlows.push(tailGlow);

      // High-mount centre brake light
      if (i === 0) {
        const hmsl = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.05, 0.06), brakeMat.clone());
        hmsl.position.set(0, 1.06, -2.00);
        hmsl.visible = false;
        this.bodyPivot.add(hmsl);
        this._hmsl = hmsl;
        this._brakeLamps.push(hmsl);
      }
    });

    // Reverse light (white, rear centre)
    const revMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 3, roughness: 0.2,
    });
    this._reverseLight = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.10, 0.06), revMat);
    this._reverseLight.userData.onEmissiveIntensity = this._reverseLight.material.emissiveIntensity;
    this._reverseLight.position.set(0, 0.40, -2.10);
    this._reverseLight.visible = false;
    this.bodyPivot.add(this._reverseLight);

    // Reverse point light
    this._reversePL = new THREE.PointLight(0xffffff, 0, 6, 2);
    this._reversePL.position.set(0, 0.38, -2.3);
    this.bodyPivot.add(this._reversePL);

    const frontAxleZ = this.wheelBase * 0.5;
    const rearAxleZ = -this.wheelBase * 0.5;
    this._setLightFit(
      frontAxleZ + 0.36,
      rearAxleZ - 0.40,
      this.trackWidth * 0.40,
      this.trackWidth * 0.40,
      this.wheelRadius + 0.30,
      this.wheelRadius + 0.26
    );
    this.setLightSystemEnabled(this._lightSystemEnabled);
  }

  _setLightFit(frontZ, rearZ, frontLx, rearLx, frontY, rearY) {
    this._lightFit = { frontZ, rearZ, frontLx, rearLx, frontY, rearY };
    this._alignLightAnchors(frontZ, rearZ, frontLx, rearLx, frontY, rearY);
  }

  updateLightMountTuning(patch = {}) {
    this.lightMountTuning = { ...this.lightMountTuning, ...patch };
    if (!this._lightFit) return;
    const { frontZ, rearZ, frontLx, rearLx, frontY, rearY } = this._lightFit;
    this._alignLightAnchors(frontZ, rearZ, frontLx, rearLx, frontY, rearY);
  }

  setLightSystemEnabled(nextEnabled) {
    this._lightSystemEnabled = !!nextEnabled;

    this._headlightBeams.forEach((beam) => {
      beam.intensity = this._lightSystemEnabled ? (beam.userData.onIntensity ?? 5.4) : 0;
    });
    this._frontFills.forEach((fill) => {
      fill.intensity = this._lightSystemEnabled ? (fill.userData.onIntensity ?? 1.8) : 0;
    });
    this._headlights.forEach((mesh) => {
      if (!mesh.material) return;
      mesh.material.emissiveIntensity = this._lightSystemEnabled
        ? (mesh.userData.onEmissiveIntensity ?? 7.2)
        : 0.05;
    });
    this._tailLamps.forEach((mesh) => {
      if (!mesh.material) return;
      mesh.material.emissiveIntensity = this._lightSystemEnabled
        ? (mesh.userData.onEmissiveIntensity ?? 2.4)
        : 0.02;
    });
    this._tailGlows.forEach((glow) => {
      glow.intensity = this._lightSystemEnabled ? (glow.userData.onIntensity ?? 0.8) : 0;
    });
    if (this._reverseLight?.material) {
      this._reverseLight.material.emissiveIntensity = this._lightSystemEnabled
        ? (this._reverseLight.userData.onEmissiveIntensity ?? 3)
        : 0.02;
    }
  }

  toggleLightSystem() {
    this.setLightSystemEnabled(!this._lightSystemEnabled);
    return this._lightSystemEnabled;
  }

  _alignLightAnchors(frontZ, rearZ, frontLx, rearLx, frontY, rearY) {
    const tune = this.lightMountTuning;
    const frontX = Math.abs(frontLx + tune.frontX);
    const rearX = Math.abs(rearLx + tune.rearX);
    const fittedFrontY = frontY + tune.frontY;
    const fittedRearY = rearY + tune.rearY;
    const fittedFrontZ = frontZ + tune.frontZ;
    const fittedRearZ = rearZ + tune.rearZ;
    const rearFaceZ = fittedRearZ + 0.09;

    this._headlights.forEach((l, i) => {
      l.position.set(i === 0 ? -frontX : frontX, fittedFrontY, fittedFrontZ - 0.01);
    });
    this._headlightBeams.forEach((beam, i) => {
      beam.position.set(i === 0 ? -frontX : frontX, fittedFrontY - 0.01, fittedFrontZ + 0.06);
    });
    this._frontFills.forEach((fill, i) => {
      fill.position.set(i === 0 ? -frontX : frontX, fittedFrontY - 0.04, fittedFrontZ + 0.24);
    });
    this._tailLamps.forEach((l, i) => {
      l.position.set(i === 0 ? -rearX : rearX, fittedRearY, rearFaceZ);
    });
    this._brakeLamps.forEach((l, i) => {
      if (i < 2) l.position.set(i === 0 ? -rearX : rearX, fittedRearY, rearFaceZ + 0.005);
    });
    this._tailGlows.forEach((glow, i) => {
      glow.position.set(i === 0 ? -rearX : rearX, fittedRearY - 0.02, rearFaceZ - 0.03);
    });
    if (this._hmsl) this._hmsl.position.set(0, fittedRearY + 0.36, rearFaceZ + 0.02);
    this._reverseLight.position.set(0, fittedRearY - 0.06, rearFaceZ + 0.02);
    this._reversePL.position.set(0, fittedRearY - 0.08, rearFaceZ - 0.05);
    this._headlightTargets.forEach((t, i) => {
      t.position.set(i === 0 ? -frontX * 0.60 : frontX * 0.60, fittedFrontY * 0.72, fittedFrontZ + 12);
    });
    if (this._exhaustOrigin) {
      this._exhaustOrigin.set(-rearX * 0.64, fittedRearY - 0.10, rearFaceZ - 0.07);
    }
  }

  _collectMeshVerticesInBodySpace(mesh) {
    const pos = mesh?.geometry?.attributes?.position;
    if (!pos || pos.count === 0) return [];

    mesh.updateWorldMatrix(true, false);
    this.bodyPivot.updateWorldMatrix(true, false);
    const toBody = new THREE.Matrix4().copy(this.bodyPivot.matrixWorld).invert();
    const transform = new THREE.Matrix4().copy(mesh.matrixWorld).premultiply(toBody);

    const v = new THREE.Vector3();
    const points = new Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      points[i] = v.fromBufferAttribute(pos, i).clone().applyMatrix4(transform);
    }
    return points;
  }

  _fitWheelsToModel(model) {
    const wheelParts = [];
    const tmpCenter = new THREE.Vector3();
    const tmpSize = new THREE.Vector3();

    model.updateWorldMatrix(true, true);
    this.bodyPivot.updateWorldMatrix(true, true);
    const toBody = new THREE.Matrix4().copy(this.bodyPivot.matrixWorld).invert();

    model.traverse((node) => {
      if (!node.isMesh) return;
      const n = (node.name || '').toLowerCase();
      if (!n.includes('wheel') && !n.includes('tyre') && !n.includes('tire') && !n.includes('rim')) return;

      const box = new THREE.Box3().setFromObject(node);
      if (box.isEmpty()) return;

      box.getCenter(tmpCenter);
      box.getSize(tmpSize);
      const center = tmpCenter.clone().applyMatrix4(toBody);
      const dims = [Math.abs(tmpSize.x), Math.abs(tmpSize.y), Math.abs(tmpSize.z)].sort((a, b) => a - b);

      wheelParts.push({
        x: center.x,
        z: center.z,
        width: Math.max(0.05, dims[0]),
        radius: Math.max(0.05, dims[2] * 0.5),
      });
    });

    if (wheelParts.length < 4) return false;

    const sortedZ = wheelParts.map((p) => p.z).sort((a, b) => a - b);
    const zMedian = sortedZ[Math.floor(sortedZ.length * 0.5)];
    const fl = wheelParts.filter((p) => p.z >= zMedian && p.x < 0);
    const fr = wheelParts.filter((p) => p.z >= zMedian && p.x >= 0);
    const rl = wheelParts.filter((p) => p.z < zMedian && p.x < 0);
    const rr = wheelParts.filter((p) => p.z < zMedian && p.x >= 0);
    if (!fl.length || !fr.length || !rl.length || !rr.length) return false;

    const avg = (arr, key) => arr.reduce((sum, v) => sum + v[key], 0) / arr.length;
    const frontZ = (avg(fl, 'z') + avg(fr, 'z')) * 0.5;
    const rearZ = (avg(rl, 'z') + avg(rr, 'z')) * 0.5;
    const leftX = (avg(fl, 'x') + avg(rl, 'x')) * 0.5;
    const rightX = (avg(fr, 'x') + avg(rr, 'x')) * 0.5;

    const avgRadius = avg(wheelParts, 'radius');
    const avgWidth = avg(wheelParts, 'width');
    const fittedRadius = THREE.MathUtils.clamp(avgRadius, this.wheelRadius * 0.72, this.wheelRadius * 1.45);
    const fittedWidth = THREE.MathUtils.clamp(avgWidth, this.wheelWidth * 0.55, this.wheelWidth * 1.65);
    const radialScale = fittedRadius / this.wheelRadius;
    const widthScale = fittedWidth / this.wheelWidth;

    const fitted = {
      fl: { x: leftX, z: frontZ },
      fr: { x: rightX, z: frontZ },
      rl: { x: leftX, z: rearZ },
      rr: { x: rightX, z: rearZ },
    };

    Object.entries(fitted).forEach(([key, pos]) => {
      const wheel = this._wheels[key];
      if (!wheel) return;
      wheel.pivot.position.x = pos.x;
      wheel.pivot.position.z = pos.z;
      wheel.baseY = fittedRadius;
      wheel.pivot.position.y = wheel.baseY - (this._suspComp[key] || 0);
      wheel.spinGroup.scale.set(widthScale, radialScale, radialScale);
    });

    return true;
  }

  _computeForwardSignFromWheelNodes(model) {
    let frontAvg = 0;
    let rearAvg = 0;
    let frontCount = 0;
    let rearCount = 0;

    model.traverse((c) => {
      const n = (c.name || '').toLowerCase();
      if (!n.includes('wheel')) return;
      if (n.includes('front')) {
        frontAvg += c.position.z;
        frontCount += 1;
      } else if (n.includes('back') || n.includes('rear')) {
        rearAvg += c.position.z;
        rearCount += 1;
      }
    });

    if (frontCount === 0 || rearCount === 0) return 1;
    frontAvg /= frontCount;
    rearAvg /= rearCount;
    return frontAvg >= rearAvg ? 1 : -1;
  }

  _fitLightsToModel(model) {
    let bodyRef = null;
    model.traverse((c) => {
      if (bodyRef || !c.isMesh) return;
      const n = (c.name || '').toLowerCase();
      if (n === 'body' || n.includes('body')) bodyRef = c;
    });

    const source = bodyRef || model;
    const points = bodyRef ? this._collectMeshVerticesInBodySpace(bodyRef) : [];

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    const pushBounds = (x, y, z) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    };

    if (points.length > 0) {
      points.forEach((p) => pushBounds(p.x, p.y, p.z));
    } else {
      source.updateWorldMatrix(true, true);
      this.bodyPivot.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(source);
      box.applyMatrix4(new THREE.Matrix4().copy(this.bodyPivot.matrixWorld).invert());
      pushBounds(box.min.x, box.min.y, box.min.z);
      pushBounds(box.max.x, box.max.y, box.max.z);
    }

    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;
    if (sizeX < 0.2 || sizeY < 0.2 || sizeZ < 0.2) return false;

    const frontBandStart = maxZ - sizeZ * 0.08;
    const rearBandEnd = minZ + sizeZ * 0.08;
    const lampYMin = minY + sizeY * 0.20;
    const lampYMax = minY + sizeY * 0.44;

    const srcPoints = points.length > 0 ? points : [
      new THREE.Vector3(minX, minY, minZ),
      new THREE.Vector3(maxX, maxY, maxZ),
      new THREE.Vector3(minX, maxY, maxZ),
      new THREE.Vector3(maxX, minY, minZ),
    ];

    const frontCandidates = srcPoints.filter(
      (p) => p.z >= frontBandStart && p.y >= lampYMin && p.y <= lampYMax
    );
    const rearCandidates = srcPoints.filter(
      (p) => p.z <= rearBandEnd && p.y >= lampYMin && p.y <= lampYMax
    );

    const frontSet = frontCandidates.length >= 6 ? frontCandidates : srcPoints.filter((p) => p.z >= frontBandStart);
    const rearSet = rearCandidates.length >= 6 ? rearCandidates : srcPoints.filter((p) => p.z <= rearBandEnd);
    if (!frontSet.length || !rearSet.length) return false;

    const frontLx = THREE.MathUtils.clamp(
      quantile(frontSet.map((p) => Math.abs(p.x)), 0.66),
      this.trackWidth * 0.34,
      this.trackWidth * 0.70
    );
    const rearLx = THREE.MathUtils.clamp(
      quantile(rearSet.map((p) => Math.abs(p.x)), 0.66),
      this.trackWidth * 0.34,
      this.trackWidth * 0.70
    );

    const frontY = quantile(frontSet.map((p) => p.y), 0.40);
    const rearY = quantile(rearSet.map((p) => p.y), 0.40);
    const frontZ = quantile(frontSet.map((p) => p.z), 0.74);
    const rearZ = quantile(rearSet.map((p) => p.z), 0.30);

    this._setLightFit(frontZ, rearZ, frontLx, rearLx, frontY, rearY);
    return true;
  }

  // ── Exhaust particles ────────────────────────────────────────────────────────

  _buildExhaust() {
    const N = 60;
    this._exhaustPositions = new Float32Array(N * 3);
    this._exhaustLifetimes = new Float32Array(N);
    this._exhaustSpeeds    = new Float32Array(N * 3);
    this._exhaustN         = N;
    for (let i = 0; i < N; i++) this._exhaustLifetimes[i] = Math.random(); // stagger

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this._exhaustPositions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xaaaaaa,
      size: 0.09,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this._exhaustParticles = new THREE.Points(geom, mat);
    this._exhaustParticles.frustumCulled = false;
    this.group.add(this._exhaustParticles);

    // Exhaust pipe position in local space (rear, slightly offset)
    this._exhaustOrigin = new THREE.Vector3(-0.35, 0.22, -2.18);
  }

  // ── GLTF model loader ────────────────────────────────────────────────────────

  _loadModel() {
    const loader = new GLTFLoader();
    loader.load(
      encodeURI(this.modelPath),
      (gltf) => {
        const model = gltf.scene;

        // Scale to physics body length
        const bb = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        bb.getSize(size);
        const scale = (this.wheelBase * 1.46) / size.z;
        model.scale.setScalar(scale);
        model.position.set(0, 0, 0);
        model.rotation.y = this._computeForwardSignFromWheelNodes(model) > 0 ? 0 : Math.PI;

        model.traverse((c) => {
          if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
            // Hide model's own wheels — ours are authoritative
            const n = c.name.toLowerCase();
            if (n.includes('wheel') || n.includes('tyre') || n.includes('tire') || n.includes('rim')) {
              c.visible = false;
            }
          }
        });

        this.bodyPivot.add(model);
        this._fitWheelsToModel(model);

        // Remove placeholder geometry
        this._placeholders.forEach((p) => {
          this.bodyPivot.remove(p);
          p.geometry?.dispose();
          [p.material].flat().forEach((m) => m?.dispose());
        });
        this._placeholders = [];
        const fitted = this._fitLightsToModel(model);
        if (!fitted) {
          const frontAxleZ = this.wheelBase * 0.5;
          const rearAxleZ = -this.wheelBase * 0.5;
          this._setLightFit(
            frontAxleZ + 0.46,
            rearAxleZ - 0.40,
            this.trackWidth * 0.40,
            this.trackWidth * 0.40,
            this.wheelRadius + 0.20,
            this.wheelRadius + 0.16
          );
        }
      },
      undefined,
      (err) => {
        console.warn('Model load failed:', err);
        this._buildPlaceholder();
      }
    );
  }

  // ── Steering ─────────────────────────────────────────────────────────────────

  _updateSteering(dt, keys) {
    const left  = keys.has('ArrowLeft')  || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    const dir   = (left ? 1 : 0) - (right ? 1 : 0);

    if (dir !== 0) {
      this.steerInput = clampAbs(this.steerInput + dir * this.steerSpeed * dt, 1);
    } else {
      // Exponential self-centering (frame-rate independent)
      this.steerInput = expLerp(this.steerInput, 0, this.steerReturnHL, dt);
      if (Math.abs(this.steerInput) < 0.002) this.steerInput = 0;
    }

    // Speed-sensitive steer reduction: narrows at high speed
    const speedRatio   = clampAbs(Math.abs(this.speed) / this.maxSpeed, 1);
    const steerLimit   = THREE.MathUtils.lerp(this.maxSteer, this.maxSteer * 0.32, speedRatio * speedRatio);
    this.steerAngle    = this.steerInput * steerLimit;
  }

  // ── Speed / throttle ─────────────────────────────────────────────────────────

  _updateSpeed(dt, keys) {
    const throttle = keys.has('ArrowUp')   || keys.has('KeyW');
    const braking  = keys.has('ArrowDown') || keys.has('KeyS');
    this._braking  = braking;

    if (throttle) {
      this.speed += this.accelRate * dt;
    } else if (braking) {
      if (this.speed > 0.1) {
        // Hard brake
        this.speed -= this.brakeRate * dt;
      } else {
        // Reverse
        this.speed -= this.accelRate * 0.6 * dt;
      }
    } else {
      // Engine braking + rolling resistance
      const engineBrakeForce = this.engineBrake + Math.abs(this.speed) * this.rollingDrag;
      this.speed -= Math.sign(this.speed) * engineBrakeForce * dt;
    }

    // Deadband
    if (Math.abs(this.speed) < 0.04) this.speed = 0;
    this.speed = THREE.MathUtils.clamp(this.speed, -this.reverseSpeed, this.maxSpeed);

    // Longitudinal acceleration for body pitch
    this._longAcc = (this.speed - this._prevSpeed) / Math.max(dt, 1e-4);
    this._prevSpeed = this.speed;

    // Lights: brake / reverse
    const showBrake   = braking && this.speed > -0.5;
    const showReverse = this.speed < -0.35;
    this._brakeLamps.forEach((l) => { l.visible = showBrake; });
    this._reverseLight.visible      = this._lightSystemEnabled && showReverse;
    this._reversePL.intensity       = this._lightSystemEnabled && showReverse ? 1.5 : 0;
  }

  // ── Ackermann steering angles ─────────────────────────────────────────────────

  _computeAckermann() {
    const steer = this.steerAngle;
    if (Math.abs(steer) < 1e-4) return { fl: 0, fr: 0 };

    const s   = Math.sign(steer);
    const abs = Math.abs(steer);
    const R   = this.wheelBase / Math.tan(abs);   // turning radius to rear axle
    const tw  = this.trackWidth / 2;

    const inner = Math.atan(this.wheelBase / (R - tw));
    const outer = Math.atan(this.wheelBase / (R + tw));

    return s > 0
      ? { fl:  inner, fr:  outer }  // turning left
      : { fl: -outer, fr: -inner }; // turning right
  }

  // ── Dynamics: slip-angle yaw model ───────────────────────────────────────────

  _updatePose(dt) {
    if (Math.abs(this.speed) < 0.002) {
      // Relax body angles at rest
      this._bodyRoll  = expLerp(this._bodyRoll,  0, 0.08, dt);
      this._bodyPitch = expLerp(this._bodyPitch, 0, 0.08, dt);
      this.yawRate    = 0;
      this.slipAngle  = 0;
      this.bodyPivot.rotation.z = this._bodyRoll;
      this.bodyPivot.rotation.x = this._bodyPitch;
      return;
    }

    // Desired yaw rate from bicycle model
    const desiredYaw = (this.speed * Math.tan(this.steerAngle)) / this.wheelBase;

    // Lateral acceleration from centripetal (v * omega) — correct formula
    const rawLatAcc = this.speed * desiredYaw;
    this._latAcc    = rawLatAcc;

    // Grip clamp: reduce yaw if over limit (tyre saturation → understeer)
    let clampedYaw = desiredYaw;
    if (Math.abs(rawLatAcc) > this.gripLimit) {
      clampedYaw = (this.gripLimit * Math.sign(rawLatAcc)) / Math.max(Math.abs(this.speed), 0.1);
      this._latAcc = this.gripLimit * Math.sign(rawLatAcc);
      // Speed bleeds more on oversteer (rear-drive feel)
      this.speed *= Math.pow(0.992, 60 * dt);
      this._skidding = true;
    } else {
      this._skidding = false;
    }

    // Slip angle: body orientation lags behind velocity direction slightly
    const targetSlip = this.steerAngle * this.slipFactor * (Math.abs(this.speed) / this.maxSpeed);
    this.slipAngle   = expLerp(this.slipAngle, targetSlip, 0.12, dt);

    // Integrate yaw
    this.yawRate  = clampedYaw;
    this.heading += (this.yawRate + this.slipAngle) * dt;
    this.group.rotation.y = this.heading;

    // Translate along velocity direction (heading + slip = actual travel direction)
    const travelDir = this.heading - this.slipAngle * 0.5;
    const fwd = new THREE.Vector3(Math.sin(travelDir), 0, Math.cos(travelDir));
    this.group.position.addScaledVector(fwd, this.speed * dt);

    // Body roll — proportional to lateral g, relative to CG height
    const targetRoll  = -(this._latAcc / 9.81) * (this.cg_height / this.trackWidth) * 0.7;
    const targetPitch = -(this._longAcc / 9.81) * 0.018;

    this._bodyRoll  = expLerp(this._bodyRoll,  targetRoll,  0.06, dt);
    this._bodyPitch = expLerp(this._bodyPitch, targetPitch, 0.07, dt);

    this.bodyPivot.rotation.z = clampAbs(this._bodyRoll,  0.10);
    this.bodyPivot.rotation.x = clampAbs(this._bodyPitch, 0.07);
  }

  // ── Suspension simulation ────────────────────────────────────────────────────

  _updateSuspension(dt) {
    // Compute per-corner load transfer
    const longTransfer = (this._longAcc / 9.81) * this.cg_height / this.wheelBase;
    const latTransfer  = (this._latAcc  / 9.81) * this.cg_height / this.trackWidth;

    const targets = {
      fl:  longTransfer - latTransfer,
      fr:  longTransfer + latTransfer,
      rl: -longTransfer - latTransfer,
      rr: -longTransfer + latTransfer,
    };

    Object.keys(this._wheels).forEach((key) => {
      const w = this._wheels[key];
      const targetComp = clampAbs(targets[key] * this.suspRange, this.suspRange);

      // Spring-damper (critically damped feel)
      const vel  = this._suspVel[key] || 0;
      const comp = this._suspComp[key] || 0;
      const force = -this.suspK * (comp - targetComp) - vel / this.suspDamp;
      const newVel  = vel + force * dt;
      const newComp = comp + newVel * dt;

      this._suspVel[key]  = newVel;
      this._suspComp[key] = clampAbs(newComp, this.suspRange);

      // Apply Y offset to wheel pivot
      w.pivot.position.y = w.baseY - this._suspComp[key];
    });
  }

  // ── Wheel steering + spin ────────────────────────────────────────────────────

  _updateWheels(dt) {
    const { fl, fr } = this._computeAckermann();
    this._wheels.fl.pivot.rotation.y = fl;
    this._wheels.fr.pivot.rotation.y = fr;

    const spinDelta = (this.speed / this.wheelRadius) * dt;
    this._wheelSpin += spinDelta;

    Object.values(this._wheels).forEach(({ spinGroup }) => {
      spinGroup.rotation.x = this._wheelSpin;
    });
  }

  // ── Exhaust particle update ───────────────────────────────────────────────────

  _updateExhaust(dt) {
    const N       = this._exhaustN;
    const pos     = this._exhaustPositions;
    const life    = this._exhaustLifetimes;
    const vel     = this._exhaustSpeeds;
    const origin  = this._exhaustOrigin;
    const emit    = Math.abs(this.speed) > 0.5 || this._braking;
    const opacity = emit ? Math.min(0.35, Math.abs(this.speed) / this.maxSpeed * 0.4) : 0;
    this._exhaustParticles.material.opacity = expLerp(
      this._exhaustParticles.material.opacity, opacity, 0.15, dt
    );

    // Keep exhaust particles in world space so the smoke trail does not stick to the car body.
    if (!this._exhaustWorldSpace && this.group.parent) {
      this.group.parent.attach(this._exhaustParticles);
      this._exhaustWorldSpace = true;
    }

    this.group.updateMatrixWorld(true);

    // World-space exhaust origin
    const worldOrigin = origin.clone().applyMatrix4(this.group.matrixWorld);
    const backward    = new THREE.Vector3(0, 0, -1).applyQuaternion(this.group.quaternion);

    for (let i = 0; i < N; i++) {
      life[i] -= dt * 1.8;
      if (life[i] <= 0) {
        // Respawn
        life[i] = 1.0;
        pos[i * 3]     = worldOrigin.x + (Math.random() - 0.5) * 0.06;
        pos[i * 3 + 1] = worldOrigin.y;
        pos[i * 3 + 2] = worldOrigin.z + (Math.random() - 0.5) * 0.06;
        const spd = 0.6 + Math.random() * 0.4;
        vel[i * 3]     = backward.x * spd + (Math.random() - 0.5) * 0.2;
        vel[i * 3 + 1] = 0.15 + Math.random() * 0.15;
        vel[i * 3 + 2] = backward.z * spd + (Math.random() - 0.5) * 0.2;
      }
      pos[i * 3]     += vel[i * 3]     * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
    }
    this._exhaustParticles.geometry.attributes.position.needsUpdate = true;
  }

  // ── Public update (call from render loop) ────────────────────────────────────

  update(dt, keys) {
    // Cap dt to avoid physics explosion on tab-switch
    const safeDt = Math.min(dt, 0.05);

    this._updateSteering(safeDt, keys);
    this._updateSpeed(safeDt, keys);
    this._updatePose(safeDt);
    this._updateSuspension(safeDt);
    this._updateWheels(safeDt);
    this._updateExhaust(safeDt);
  }

  // ── Public getters (useful for HUD / camera) ─────────────────────────────────

  get isSkidding()       { return this._skidding; }
  get lateralG()         { return this._latAcc / 9.81; }
  get longitudinalG()    { return this._longAcc / 9.81; }
  get speedKmh()         { return this.speed * 3.6; }
  get position()         { return this.group.position; }
  get lightsEnabled()    { return this._lightSystemEnabled; }
}
