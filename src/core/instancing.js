import * as THREE from 'three';

const scratchMatrix = new THREE.Matrix4();
const scratchQuat = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();
const scratchPos = new THREE.Vector3();
const scratchScale = new THREE.Vector3();

/**
 * Builds one InstancedMesh from a list of placements.
 *
 * Replacing per-object `new Mesh(new BoxGeometry(...))` loops with this is the single
 * biggest draw-call win in the scene: guardrails alone drop from 252 draws to 2.
 *
 * @param {THREE.BufferGeometry} geometry shared geometry
 * @param {THREE.Material} material shared material
 * @param {Array<{x:number,y:number,z:number,rotationY?:number,rotationX?:number,rotationZ?:number,scale?:number|{x:number,y:number,z:number}}>} placements
 */
export function buildInstances(geometry, material, placements, options = {}) {
  const {
    castShadow = false,
    receiveShadow = true,
    name = 'instances',
    dynamic = false,
  } = options;

  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.instanceMatrix.setUsage(dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);

  placements.forEach((p, i) => mesh.setMatrixAt(i, composeMatrix(p)));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Composes a placement into the shared scratch matrix (no allocation). */
export function composeMatrix(p) {
  scratchPos.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
  scratchEuler.set(p.rotationX ?? 0, p.rotationY ?? 0, p.rotationZ ?? 0);
  scratchQuat.setFromEuler(scratchEuler);
  const s = p.scale ?? 1;
  if (typeof s === 'number') scratchScale.set(s, s, s);
  else scratchScale.set(s.x ?? 1, s.y ?? 1, s.z ?? 1);
  return scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
}

/** Updates a single instance in place; call `mesh.instanceMatrix.needsUpdate = true` after a batch. */
export function setInstance(mesh, index, placement) {
  mesh.setMatrixAt(index, composeMatrix(placement));
}

/** Pushes an instance out of sight (used for consumed/destroyed props). */
export function hideInstance(mesh, index) {
  scratchMatrix.makeScale(0, 0, 0);
  mesh.setMatrixAt(index, scratchMatrix);
}
