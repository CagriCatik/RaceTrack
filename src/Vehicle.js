import * as THREE from 'three';
import { loadModel } from './core/assetLoader.js';
import { mergeVehicleConfig, vehicleConfig as defaultVehicleConfig } from './config/vehicleConfig.js';
import { modelPath } from './config/carCatalog.js';

// ─── Math helpers ─────────────────────────────────────────────────────────────

/** Frame-rate-independent exponential smoothing: feels the same at any fps. */
const expLerp = (a, b, halfLife, dt) =>
  b + (a - b) * Math.exp((-Math.LN2 / Math.max(halfLife, 1e-4)) * dt);

const clampAbs = (v, limit) => (v > limit ? limit : v < -limit ? -limit : v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ─── Shared geometry (one instance for every vehicle ever created) ───────────

const lampGeometry = {
  head: new THREE.BoxGeometry(0.2, 0.12, 0.06),
  drl: new THREE.BoxGeometry(0.18, 0.03, 0.05),
  tail: new THREE.BoxGeometry(0.24, 0.14, 0.07),
  hmsl: new THREE.BoxGeometry(0.6, 0.05, 0.06),
  reverse: new THREE.BoxGeometry(0.18, 0.1, 0.06),
};

let fallbackWheelGeometry = null;
function getFallbackWheelGeometry() {
  if (!fallbackWheelGeometry) {
    // One low-poly tyre, reused for all corners of all cars that fail to load.
    const tyre = new THREE.CylinderGeometry(1, 1, 1, 16);
    tyre.rotateZ(Math.PI / 2);
    fallbackWheelGeometry = tyre;
  }
  return fallbackWheelGeometry;
}

let fallbackWheelMaterial = null;
let fallbackBodyMaterial = null;

// Scratch objects: the physics step must not allocate.
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _box = new THREE.Box3();
const _mat4 = new THREE.Matrix4();

// ─── Vehicle ──────────────────────────────────────────────────────────────────

export default class Vehicle {
  constructor(position = new THREE.Vector3(0, 0, 0), options = {}) {
    this.config = mergeVehicleConfig(defaultVehicleConfig, options);
    const { geometry, dynamics, suspension, lights, model, effects } = this.config;

    // ── Geometry (overwritten by real values once the GLB is measured)
    this.wheelBase = geometry.wheelBase;
    this.trackWidth = geometry.trackWidth;
    this.wheelRadius = geometry.wheelRadius;
    this.wheelWidth = geometry.wheelWidth;
    this.cg_height = geometry.cgHeight;
    this.bodyLength = model.bodyLength;
    this.collisionRadius = model.bodyLength * 0.42;
    this.bodyTop = 1.2;
    this.bodyFront = model.bodyLength * 0.5;

    // ── Dynamics state
    this.speed = 0;        // m/s along the chassis forward axis (+Z local)
    this.heading = 0;      // world yaw of the velocity/chassis (rad)
    this.steerInput = 0;   // [-1, 1]
    this.steerAngle = 0;   // front wheel angle (rad)
    this.slipAngle = 0;    // visual body yaw offset (rad) — drift look
    this.yawRate = 0;

    // ── Tuning
    this.maxSpeed = dynamics.maxSpeed;
    this.reverseSpeed = dynamics.reverseSpeed;
    this.accelRate = dynamics.accelRate;
    this.engineBrake = dynamics.engineBrake;
    this.brakeRate = dynamics.brakeRate;
    this.handbrakeRate = dynamics.handbrakeRate;
    this.rollingDrag = dynamics.rollingDrag;
    this.maxSteerDeg = dynamics.maxSteerDeg;
    this.maxSteer = THREE.MathUtils.degToRad(this.maxSteerDeg);
    this.steerSpeed = dynamics.steerSpeed;
    this.steerReturnHL = dynamics.steerReturnHalfLife;
    this.gripLimit = dynamics.gripLimit;
    this.slipFactor = dynamics.slipFactor;

    // ── Suspension
    this.suspK = suspension.spring;
    this.suspDamp = suspension.dampingHalfLife;
    this.suspRange = suspension.travel;
    this._suspComp = { fl: 0, fr: 0, rl: 0, rr: 0 };
    this._suspVel = { fl: 0, fr: 0, rl: 0, rr: 0 };

    // ── Internal state
    this._prevSpeed = 0;
    this._longAcc = 0;
    this._latAcc = 0;
    this._bodyRoll = 0;
    this._bodyPitch = 0;
    this._wheelSpin = 0;
    this._skidding = false;
    this._braking = false;
    this._handbraking = false;

    // ── Scene graph
    this.group = new THREE.Group();
    this.group.name = `vehicle:${model.id}`;
    this.group.position.copy(position);
    this.bodyPivot = new THREE.Group(); // roll / pitch only
    this.group.add(this.bodyPivot);

    this._wheels = {};
    this._modelRoot = null;
    this._headlights = [];
    this._tailLamps = [];
    this._drls = [];
    this._headlightBeams = [];
    this._headlightTargets = [];
    this._rearGlow = null;
    this._hmsl = null;
    this._reverseLight = null;
    this._lampMaterials = null;
    this._lightSystemEnabled = true;
    this._realtimeLights = lights.realtime !== false;
    this._lampsEnabled = lights.lamps !== false;
    this._lightFit = null;
    this.lightMountTuning = { ...lights.tuning };

    this._exhaustCount = Math.max(0, effects.exhaustParticles | 0);
    this._exhaustParticles = null;
    this._exhaustWorldSpace = false;
    this._exhaustOrigin = new THREE.Vector3(-0.35, 0.22, -2.18);

    if (this._lampsEnabled) this._buildLamps();
    if (this._exhaustCount > 0) this._buildExhaust();

    /** Resolves once the GLB is in place (or the fallback body was built). */
    this.ready = this._loadModel();
  }

  /** Convenience factory: `const car = await Vehicle.create(pos, opts)`. */
  static async create(position, options) {
    const vehicle = new Vehicle(position, options);
    await vehicle.ready;
    return vehicle;
  }

  // ── Model ───────────────────────────────────────────────────────────────────

  async _loadModel() {
    const path = modelPath(this.config.model.id);
    try {
      const model = await loadModel(path);
      this._installModel(model);
    } catch (err) {
      console.warn(`[vehicle] ${path} failed to load, using fallback body.`, err);
      this._buildFallbackBody();
      this._buildFallbackWheels();
      this._fitLampsToBounds(null);
    }
    return this;
  }

  _installModel(model) {
    // Scale to the configured bumper-to-bumper length.
    _box.setFromObject(model);
    _box.getSize(_v3a);
    const lengthAxis = Math.max(_v3a.z, 1e-3);
    const scale = this.config.model.bodyLength / lengthAxis;
    model.scale.setScalar(scale);

    // Kenney models face +Z; rotate if the wheel nodes say otherwise.
    model.rotation.y = this._computeForwardSign(model) > 0 ? 0 : Math.PI;
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);

    this.bodyPivot.add(model);
    this._modelRoot = model;

    const gotWheels = this._adoptModelWheels(model);
    if (!gotWheels) this._buildFallbackWheels();

    this._fitLampsToBounds(model);
  }

  /** +1 if the model's front wheels sit at +Z, -1 otherwise. */
  _computeForwardSign(model) {
    let front = 0;
    let frontCount = 0;
    let rear = 0;
    let rearCount = 0;
    model.traverse((node) => {
      const name = (node.name || '').toLowerCase();
      if (!name.includes('wheel')) return;
      if (name.includes('front')) { front += node.position.z; frontCount++; }
      else if (name.includes('back') || name.includes('rear')) { rear += node.position.z; rearCount++; }
    });
    if (!frontCount || !rearCount) return 1;
    return front / frontCount >= rear / rearCount ? 1 : -1;
  }

  /**
   * Re-parents the model's own wheel meshes onto steer/spin pivots.
   *
   * The previous version hid them and drew a procedural 12-mesh chrome rim per corner
   * (48 extra meshes per car, clashing with the kit's flat-shaded look). Using the
   * shipped wheels costs 4 meshes, shares the kit material, and — because we measure
   * them — makes wheelbase, track width and wheel radius match the visible car.
   */
  _adoptModelWheels(model) {
    const found = [];
    model.updateWorldMatrix(true, true);
    this.group.updateWorldMatrix(true, false);
    _mat4.copy(this.group.matrixWorld).invert();

    model.traverse((node) => {
      if (!node.isMesh) return;
      if (!(node.name || '').toLowerCase().includes('wheel')) return;
      _box.setFromObject(node);
      if (_box.isEmpty()) return;
      _box.getCenter(_v3a).applyMatrix4(_mat4);
      _box.getSize(_v3b);
      found.push({
        node,
        x: _v3a.x,
        y: _v3a.y,
        z: _v3a.z,
        radius: Math.max(_v3b.y, _v3b.z) * 0.5,
        width: Math.max(_v3b.x, 0.02),
      });
    });

    if (found.length < 4) return false;

    // Classify by measured position, not by name: the model may have been flipped.
    const zs = found.map((w) => w.z).sort((a, b) => a - b);
    const zMid = zs[zs.length >> 1];
    const pick = (isFront, isLeft) =>
      found.filter((w) => (w.z >= zMid) === isFront && (w.x > 0) === isLeft);

    const corners = {
      fl: pick(true, true),
      fr: pick(true, false),
      rl: pick(false, true),
      rr: pick(false, false),
    };
    if (Object.values(corners).some((list) => list.length === 0)) return false;

    const avg = (list, key) => list.reduce((s, w) => s + w[key], 0) / list.length;

    for (const [key, list] of Object.entries(corners)) {
      const pivot = new THREE.Group();
      pivot.name = `wheel-${key}`;
      pivot.position.set(avg(list, 'x'), avg(list, 'y'), avg(list, 'z'));
      this.group.add(pivot);

      const spinGroup = new THREE.Group();
      pivot.add(spinGroup);
      pivot.updateMatrixWorld(true);

      // `attach` preserves the world transform, so each wheel ends up centred
      // on its own pivot regardless of the model's scale/rotation.
      for (const w of list) spinGroup.attach(w.node);

      this._wheels[key] = {
        pivot,
        spinGroup,
        steerable: key === 'fl' || key === 'fr',
        baseY: pivot.position.y,
      };
    }

    // Adopt the real geometry so physics and visuals agree.
    const radius = found.reduce((s, w) => s + w.radius, 0) / found.length;
    const width = found.reduce((s, w) => s + w.width, 0) / found.length;
    this.wheelRadius = radius;
    this.wheelWidth = width;
    this.wheelBase = Math.abs(avg(corners.fl, 'z') - avg(corners.rl, 'z')) || this.wheelBase;
    this.trackWidth = Math.abs(avg(corners.fl, 'x') - avg(corners.fr, 'x')) || this.trackWidth;
    return true;
  }

  _buildFallbackWheels() {
    if (Object.keys(this._wheels).length) return;
    if (!fallbackWheelMaterial) {
      fallbackWheelMaterial = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8 });
    }
    const r = this.wheelRadius;
    const positions = {
      fl: [this.trackWidth * 0.5, this.wheelBase * 0.5],
      fr: [-this.trackWidth * 0.5, this.wheelBase * 0.5],
      rl: [this.trackWidth * 0.5, -this.wheelBase * 0.5],
      rr: [-this.trackWidth * 0.5, -this.wheelBase * 0.5],
    };
    for (const [key, [x, z]] of Object.entries(positions)) {
      const pivot = new THREE.Group();
      pivot.position.set(x, r, z);
      this.group.add(pivot);
      const spinGroup = new THREE.Group();
      spinGroup.scale.set(this.wheelWidth, r, r);
      pivot.add(spinGroup);
      const mesh = new THREE.Mesh(getFallbackWheelGeometry(), fallbackWheelMaterial);
      mesh.castShadow = true;
      spinGroup.add(mesh);
      this._wheels[key] = { pivot, spinGroup, steerable: z > 0, baseY: r };
    }
  }

  _buildFallbackBody() {
    if (!fallbackBodyMaterial) {
      fallbackBodyMaterial = new THREE.MeshStandardMaterial({ color: 0x1f66c2, roughness: 0.4, metalness: 0.2 });
    }
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, this.bodyLength * 0.92), fallbackBodyMaterial);
    hull.position.y = 0.55;
    hull.castShadow = true;
    hull.receiveShadow = true;
    this.bodyPivot.add(hull);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, this.bodyLength * 0.4), fallbackBodyMaterial);
    cabin.position.set(0, 1.05, -0.2);
    cabin.castShadow = true;
    this.bodyPivot.add(cabin);
  }

  // ── Lamps & lights ──────────────────────────────────────────────────────────

  _buildLamps() {
    // Materials are per-vehicle (each car toggles its own lights) but geometry is shared.
    const m = {
      head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff5cc, emissiveIntensity: 5.5, roughness: 0.1 }),
      drl: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdff1ff, emissiveIntensity: 5, roughness: 0.1 }),
      tail: new THREE.MeshStandardMaterial({ color: 0x4a0000, emissive: 0xcc1100, emissiveIntensity: 2.2, roughness: 0.3 }),
      brake: new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 6, roughness: 0.2 }),
      reverse: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 3, roughness: 0.2 }),
    };
    this._lampMaterials = m;
    this._tailBaseIntensity = m.tail.emissiveIntensity;

    const addLamp = (geom, mat, list) => {
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.bodyPivot.add(mesh);
      list?.push(mesh);
      return mesh;
    };

    for (let i = 0; i < 2; i++) {
      addLamp(lampGeometry.head, m.head, this._headlights);
      addLamp(lampGeometry.drl, m.drl, this._drls);
      addLamp(lampGeometry.tail, m.tail, this._tailLamps);
    }

    this._hmsl = addLamp(lampGeometry.hmsl, m.brake);
    this._hmsl.visible = false;
    this._reverseLight = addLamp(lampGeometry.reverse, m.reverse);
    this._reverseLight.visible = false;

    if (this._realtimeLights) this._buildRealtimeLights();
  }

  /**
   * Real lights are a *budget*, not a decoration. Each one adds a per-fragment loop
   * iteration in every lit material, so only the player's car gets them: two
   * headlight spots and a single shared rear point light instead of the previous
   * seven lights per car (which were merely set to intensity 0 on rivals — still
   * costing shader work).
   */
  _buildRealtimeLights() {
    for (let i = 0; i < 2; i++) {
      const target = new THREE.Object3D();
      this.bodyPivot.add(target);
      this._headlightTargets.push(target);

      const beam = new THREE.SpotLight(0xfff7d0, 5.4, 70, THREE.MathUtils.degToRad(26), 0.35, 1.1);
      beam.castShadow = false;
      beam.target = target;
      beam.userData.onIntensity = beam.intensity;
      this.bodyPivot.add(beam);
      this._headlightBeams.push(beam);
    }

    this._rearGlow = new THREE.PointLight(0xff2200, 0.9, 7, 2);
    this._rearGlow.userData.onIntensity = this._rearGlow.intensity;
    this.bodyPivot.add(this._rearGlow);
  }

  /**
   * Places the lamps from the body's bounding box.
   *
   * The old implementation copied every vertex of the body mesh into a `Vector3`
   * array and ran four quantile passes over it. This walks the position attribute
   * once, in place, to find the real width of the front/rear faces.
   */
  _fitLampsToBounds(model) {
    if (!this._lampsEnabled) return;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let bodyMesh = null;

    if (model) {
      // Prefer the mesh actually called "body"; fall back to the first non-wheel mesh.
      let fallback = null;
      model.traverse((node) => {
        if (!node.isMesh || bodyMesh) return;
        const name = (node.name || '').toLowerCase();
        if (name.includes('wheel')) return;
        if (name === 'body') bodyMesh = node;
        else if (!fallback) fallback = node;
      });
      bodyMesh = bodyMesh || fallback;
    }

    this.bodyPivot.updateWorldMatrix(true, true);
    const toBody = _mat4.copy(this.bodyPivot.matrixWorld).invert();

    if (bodyMesh) {
      bodyMesh.updateWorldMatrix(true, false);
      const m = new THREE.Matrix4().copy(bodyMesh.matrixWorld).premultiply(toBody);
      const pos = bodyMesh.geometry.attributes.position;
      const e = m.elements;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
        const x = e[0] * px + e[4] * py + e[8] * pz + e[12];
        const y = e[1] * px + e[5] * py + e[9] * pz + e[13];
        const z = e[2] * px + e[6] * py + e[10] * pz + e[14];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    }

    if (!Number.isFinite(minX) || maxZ - minZ < 0.2) {
      const halfLen = this.bodyLength * 0.5;
      minX = -this.trackWidth * 0.55; maxX = this.trackWidth * 0.55;
      minY = this.wheelRadius * 0.4; maxY = this.wheelRadius * 0.4 + 1.2;
      minZ = -halfLen; maxZ = halfLen;
    }

    const halfWidth = (maxX - minX) * 0.5;
    const height = maxY - minY;
    const lampX = clamp(halfWidth * 0.66, this.trackWidth * 0.3, this.trackWidth * 0.52);
    const lampY = minY + height * 0.38;

    // Anchor points for the hood camera; the kit models have no interior, so a
    // true cockpit view would sit inside the body shell.
    this.bodyTop = maxY;
    this.bodyFront = maxZ;

    this._lightFit = {
      frontZ: maxZ - 0.03,
      rearZ: minZ + 0.03,
      frontLx: lampX,
      rearLx: lampX,
      frontY: lampY,
      rearY: lampY,
      topY: maxY,
    };
    this._applyLampTransforms();
    this.setLightSystemEnabled(this._lightSystemEnabled);
  }

  _applyLampTransforms() {
    const fit = this._lightFit;
    if (!fit) return;
    const t = this.lightMountTuning;
    const fx = Math.abs(fit.frontLx + t.frontX);
    const rx = Math.abs(fit.rearLx + t.rearX);
    const fy = fit.frontY + t.frontY;
    const ry = fit.rearY + t.rearY;
    const fz = fit.frontZ + t.frontZ;
    const rz = fit.rearZ + t.rearZ;

    // i === 0 → left side (+X), see the coordinate note in README.
    const side = (i) => (i === 0 ? fx : -fx);
    const sideR = (i) => (i === 0 ? rx : -rx);

    this._headlights.forEach((l, i) => l.position.set(side(i), fy, fz));
    this._drls.forEach((l, i) => l.position.set(side(i), fy - 0.14, fz));
    this._tailLamps.forEach((l, i) => l.position.set(sideR(i), ry, rz));
    this._headlightBeams.forEach((b, i) => b.position.set(side(i), fy, fz + 0.05));
    this._headlightTargets.forEach((tg, i) => tg.position.set(side(i) * 0.6, fy * 0.6, fz + 14));
    if (this._hmsl) this._hmsl.position.set(0, Math.min(ry + 0.45, fit.topY - 0.05), rz + 0.02);
    if (this._reverseLight) this._reverseLight.position.set(0, ry - 0.1, rz + 0.01);
    if (this._rearGlow) this._rearGlow.position.set(0, ry, rz - 0.1);
  }

  updateLightMountTuning(patch = {}) {
    Object.assign(this.lightMountTuning, patch);
    this._applyLampTransforms();
  }

  setLightSystemEnabled(next) {
    this._lightSystemEnabled = !!next;
    const on = this._lightSystemEnabled;
    const m = this._lampMaterials;
    if (m) {
      m.head.emissiveIntensity = on ? 5.5 : 0.04;
      m.drl.emissiveIntensity = on ? 5 : 0.04;
      m.tail.emissiveIntensity = on ? this._tailBaseIntensity : 0.02;
    }
    for (const beam of this._headlightBeams) {
      beam.intensity = on ? beam.userData.onIntensity : 0;
      beam.visible = on;
    }
    if (this._rearGlow) {
      this._rearGlow.intensity = on ? this._rearGlow.userData.onIntensity : 0;
      this._rearGlow.visible = on;
    }
  }

  toggleLightSystem() {
    this.setLightSystemEnabled(!this._lightSystemEnabled);
    return this._lightSystemEnabled;
  }

  // ── Exhaust ─────────────────────────────────────────────────────────────────

  _buildExhaust() {
    const n = this._exhaustCount;
    this._exhaustPositions = new Float32Array(n * 3);
    this._exhaustVelocities = new Float32Array(n * 3);
    this._exhaustLifetimes = new Float32Array(n);
    for (let i = 0; i < n; i++) this._exhaustLifetimes[i] = Math.random();

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this._exhaustPositions, 3).setUsage(THREE.DynamicDrawUsage));

    this._exhaustParticles = new THREE.Points(
      geom,
      new THREE.PointsMaterial({
        color: 0xaaaaaa,
        size: 0.1,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    this._exhaustParticles.frustumCulled = false;
    this._exhaustParticles.renderOrder = 2;
    this.group.add(this._exhaustParticles);
  }

  _placeExhaustOrigin() {
    const fit = this._lightFit;
    if (!fit) return;
    this._exhaustOrigin.set(-fit.rearLx * 0.6, Math.max(0.12, fit.rearY - 0.18), fit.rearZ - 0.05);
  }

  _updateExhaust(dt) {
    const particles = this._exhaustParticles;
    if (!particles) return;

    const n = this._exhaustCount;
    const pos = this._exhaustPositions;
    const vel = this._exhaustVelocities;
    const life = this._exhaustLifetimes;
    const speedNorm = Math.abs(this.speed) / this.maxSpeed;
    const target = speedNorm > 0.03 || this._braking ? Math.min(0.32, speedNorm * 0.4) : 0;
    particles.material.opacity = expLerp(particles.material.opacity, target, 0.15, dt);

    if (particles.material.opacity < 0.003 && target === 0) return;

    // Keep the trail in world space so smoke does not stick to the body.
    if (!this._exhaustWorldSpace && this.group.parent) {
      this.group.parent.attach(particles);
      this._exhaustWorldSpace = true;
    }

    this.group.updateMatrixWorld(true);
    _v3a.copy(this._exhaustOrigin).applyMatrix4(this.group.matrixWorld);
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);

    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      life[i] -= dt * 1.8;
      if (life[i] <= 0) {
        life[i] = 1;
        pos[i3] = _v3a.x + (Math.random() - 0.5) * 0.06;
        pos[i3 + 1] = _v3a.y;
        pos[i3 + 2] = _v3a.z + (Math.random() - 0.5) * 0.06;
        const spd = 0.6 + Math.random() * 0.4;
        vel[i3] = -sinH * spd + (Math.random() - 0.5) * 0.2;
        vel[i3 + 1] = 0.15 + Math.random() * 0.15;
        vel[i3 + 2] = -cosH * spd + (Math.random() - 0.5) * 0.2;
      }
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
    }
    particles.geometry.attributes.position.needsUpdate = true;
  }

  // ── Steering ────────────────────────────────────────────────────────────────

  _updateSteering(dt, keys) {
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    const dir = (left ? 1 : 0) - (right ? 1 : 0);

    if (dir !== 0) {
      this.steerInput = clampAbs(this.steerInput + dir * this.steerSpeed * dt, 1);
    } else {
      this.steerInput = expLerp(this.steerInput, 0, this.steerReturnHL, dt);
      if (Math.abs(this.steerInput) < 0.002) this.steerInput = 0;
    }

    const speedRatio = Math.min(Math.abs(this.speed) / this.maxSpeed, 1);
    const steerLimit = THREE.MathUtils.lerp(this.maxSteer, this.maxSteer * 0.32, speedRatio * speedRatio);
    this.steerAngle = this.steerInput * steerLimit;
  }

  // ── Speed ───────────────────────────────────────────────────────────────────

  _updateSpeed(dt, keys) {
    const throttle = keys.has('ArrowUp') || keys.has('KeyW');
    const braking = keys.has('ArrowDown') || keys.has('KeyS');
    const handbrake = keys.has('Space');
    this._braking = braking;
    this._handbraking = handbrake;

    if (handbrake) {
      const decel = this.handbrakeRate * dt;
      this.speed = Math.abs(this.speed) <= decel ? 0 : this.speed - Math.sign(this.speed) * decel;
    } else if (throttle) {
      this.speed += this.accelRate * dt;
    } else if (braking) {
      if (this.speed > 0.1) this.speed -= this.brakeRate * dt;
      else this.speed -= this.accelRate * 0.6 * dt;
    } else {
      const drag = this.engineBrake + Math.abs(this.speed) * this.rollingDrag;
      this.speed -= Math.sign(this.speed) * drag * dt;
    }

    if (Math.abs(this.speed) < 0.04) this.speed = 0;
    this.speed = clamp(this.speed, -this.reverseSpeed, this.maxSpeed);

    this._longAcc = (this.speed - this._prevSpeed) / Math.max(dt, 1e-4);
    this._prevSpeed = this.speed;

    // Lamp states
    const showBrake = (braking || handbrake) && this.speed > -0.5;
    const showReverse = this.speed < -0.35;
    if (this._lampMaterials) {
      this._lampMaterials.tail.emissiveIntensity = this._lightSystemEnabled
        ? (showBrake ? 7 : this._tailBaseIntensity)
        : (showBrake ? 5 : 0.02);
      if (this._hmsl) this._hmsl.visible = showBrake;
      if (this._reverseLight) this._reverseLight.visible = showReverse;
    }
    if (this._rearGlow && this._lightSystemEnabled) {
      this._rearGlow.intensity = showBrake ? 2.6 : this._rearGlow.userData.onIntensity;
    }
  }

  // ── Ackermann ───────────────────────────────────────────────────────────────

  /**
   * Positive steer = left turn. With forward = +Z and up = +Y the car's left side is
   * at +X, so `fl`/`rl` are the +X wheels and the *left* wheel is the inner one in a
   * left-hand corner. (The previous code handed `inner` to the -X wheel, giving the
   * outer wheel the larger angle.)
   */
  _computeAckermann() {
    const steer = this.steerAngle;
    if (Math.abs(steer) < 1e-4) return { left: 0, right: 0 };
    const abs = Math.abs(steer);
    const R = this.wheelBase / Math.tan(abs);
    const halfTrack = this.trackWidth * 0.5;
    const inner = Math.atan(this.wheelBase / Math.max(R - halfTrack, 0.05));
    const outer = Math.atan(this.wheelBase / (R + halfTrack));
    return steer > 0 ? { left: inner, right: outer } : { left: -outer, right: -inner };
  }

  // ── Pose ────────────────────────────────────────────────────────────────────

  _updatePose(dt) {
    if (Math.abs(this.speed) < 0.002) {
      this._bodyRoll = expLerp(this._bodyRoll, 0, 0.08, dt);
      this._bodyPitch = expLerp(this._bodyPitch, 0, 0.08, dt);
      this.slipAngle = expLerp(this.slipAngle, 0, 0.1, dt);
      this.yawRate = 0;
      this._latAcc = 0;
      this.bodyPivot.rotation.z = this._bodyRoll;
      this.bodyPivot.rotation.x = this._bodyPitch;
      this.group.rotation.y = this.heading + this.slipAngle;
      return;
    }

    // Bicycle model yaw rate
    const desiredYaw = (this.speed * Math.tan(this.steerAngle)) / this.wheelBase;
    const rawLatAcc = this.speed * desiredYaw;
    this._latAcc = rawLatAcc;

    let yaw = desiredYaw;
    const gripLimit = this._handbraking ? this.gripLimit * 0.55 : this.gripLimit;
    if (Math.abs(rawLatAcc) > gripLimit) {
      yaw = (gripLimit * Math.sign(rawLatAcc)) / Math.max(Math.abs(this.speed), 0.1);
      this._latAcc = gripLimit * Math.sign(rawLatAcc);
      this.speed *= Math.pow(0.992, 60 * dt); // tyres scrub speed when saturated
      this._skidding = true;
    } else {
      this._skidding = false;
    }

    // `heading` is the travel direction; `slipAngle` is only a visual yaw offset, so
    // integrating it as if it were a rate (as before) is a units error.
    this.yawRate = yaw;
    this.heading += yaw * dt;

    const targetSlip = this.steerAngle * this.slipFactor * (Math.abs(this.speed) / this.maxSpeed)
      * (this._handbraking ? 2.2 : 1);
    this.slipAngle = expLerp(this.slipAngle, targetSlip, 0.12, dt);

    this.group.rotation.y = this.heading + this.slipAngle;

    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    this.group.position.x += sinH * this.speed * dt;
    this.group.position.z += cosH * this.speed * dt;

    const targetRoll = -(this._latAcc / 9.81) * (this.cg_height / this.trackWidth) * 0.7;
    const targetPitch = -(this._longAcc / 9.81) * 0.018;
    this._bodyRoll = expLerp(this._bodyRoll, targetRoll, 0.06, dt);
    this._bodyPitch = expLerp(this._bodyPitch, targetPitch, 0.07, dt);
    this.bodyPivot.rotation.z = clampAbs(this._bodyRoll, 0.1);
    this.bodyPivot.rotation.x = clampAbs(this._bodyPitch, 0.07);
  }

  // ── Suspension ──────────────────────────────────────────────────────────────

  _updateSuspension(dt) {
    const longTransfer = (this._longAcc / 9.81) * this.cg_height / this.wheelBase;
    const latTransfer = (this._latAcc / 9.81) * this.cg_height / this.trackWidth;

    this._applyCorner('fl', longTransfer - latTransfer, dt);
    this._applyCorner('fr', longTransfer + latTransfer, dt);
    this._applyCorner('rl', -longTransfer - latTransfer, dt);
    this._applyCorner('rr', -longTransfer + latTransfer, dt);
  }

  _applyCorner(key, transfer, dt) {
    const wheel = this._wheels[key];
    if (!wheel) return;
    const targetComp = clampAbs(transfer * this.suspRange, this.suspRange);
    const vel = this._suspVel[key];
    const comp = this._suspComp[key];
    const force = -this.suspK * (comp - targetComp) - vel / this.suspDamp;
    const newVel = vel + force * dt;
    this._suspVel[key] = newVel;
    this._suspComp[key] = clampAbs(comp + newVel * dt, this.suspRange);
    wheel.pivot.position.y = wheel.baseY - this._suspComp[key];
  }

  // ── Wheels ──────────────────────────────────────────────────────────────────

  _updateWheels(dt) {
    const { left, right } = this._computeAckermann();
    if (this._wheels.fl) this._wheels.fl.pivot.rotation.y = left;
    if (this._wheels.fr) this._wheels.fr.pivot.rotation.y = right;

    // Locked wheels during a handbrake slide stop spinning.
    const spinSpeed = this._handbraking ? this.speed * 0.15 : this.speed;
    this._wheelSpin += (spinSpeed / Math.max(this.wheelRadius, 0.05)) * dt;

    for (const key in this._wheels) {
      this._wheels[key].spinGroup.rotation.x = this._wheelSpin;
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  update(dt, keys) {
    const safeDt = dt > 0.05 ? 0.05 : dt;
    this._updateSteering(safeDt, keys);
    this._updateSpeed(safeDt, keys);
    this._updatePose(safeDt);
    this._updateSuspension(safeDt);
    this._updateWheels(safeDt);
  }

  /** Visual-only work: safe to run once per rendered frame instead of per physics step. */
  updateVisuals(frameDt) {
    this._updateExhaust(frameDt > 0.1 ? 0.1 : frameDt);
  }

  /** Teleports the car to a pose and clears all accumulated state. */
  resetTo(x, z, heading) {
    this.group.position.set(x, 0, z);
    this.heading = heading;
    this.slipAngle = 0;
    this.group.rotation.y = heading;
    this.speed = 0;
    this.steerInput = 0;
    this.steerAngle = 0;
    this.yawRate = 0;
    this._prevSpeed = 0;
    this._longAcc = 0;
    this._latAcc = 0;
    this._bodyRoll = 0;
    this._bodyPitch = 0;
    this.bodyPivot.rotation.set(0, 0, 0);
    for (const key in this._suspComp) {
      this._suspComp[key] = 0;
      this._suspVel[key] = 0;
    }
  }

  dispose() {
    this._exhaustParticles?.geometry.dispose();
    this._exhaustParticles?.material.dispose();
    this._exhaustParticles?.removeFromParent();
    if (this._lampMaterials) for (const mat of Object.values(this._lampMaterials)) mat.dispose();
    this.group.removeFromParent();
  }

  get isSkidding() { return this._skidding; }
  get isBraking() { return this._braking || this._handbraking; }
  get lateralG() { return this._latAcc / 9.81; }
  get longitudinalG() { return this._longAcc / 9.81; }
  get speedKmh() { return this.speed * 3.6; }
  get position() { return this.group.position; }
  get lightsEnabled() { return this._lightSystemEnabled; }
}
