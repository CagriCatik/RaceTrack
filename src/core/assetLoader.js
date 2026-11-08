import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Central GLB loader for the Kenney kits.
 *
 * Every model inside one kit is textured with the same `Textures/colormap.png` palette
 * atlas. Loading them naively gives one texture upload and one shader program per
 * model; instead the first material of a kit becomes that kit's shared material, which
 * collapses it to one texture + one program and lets three.js batch state changes
 * between cars, props and buildings.
 *
 * The sharing is keyed *per kit*, not globally: the car kit and the city kit both ship
 * a file called `colormap.png`, but they are different palettes. One global material
 * would paint the cars with the city's colours.
 */

const loader = new GLTFLoader();
const templates = new Map();        // path -> Promise<THREE.Group>
const sharedMaterials = new Map();  // kit key -> THREE.Material

THREE.Cache.enabled = true;

/** Models living in the same directory belong to the same kit. */
function kitKeyFor(path) {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function adoptSharedMaterial(root, kitKey) {
  const seen = new Set();
  let shared = sharedMaterials.get(kitKey);

  root.traverse((node) => {
    if (!node.isMesh || !node.material) return;

    if (!shared) {
      // First model of this kit wins: promote its material to the kit's shared one.
      shared = Array.isArray(node.material) ? node.material[0] : node.material;
      shared.name = `kenney-colormap:${kitKey}`;
      shared.roughness = 0.62;
      shared.metalness = 0.05;
      shared.envMapIntensity = 0.6;
      if (shared.map) {
        // Palette atlas: nearest magnification keeps neighbouring swatches from bleeding.
        shared.map.magFilter = THREE.NearestFilter;
        shared.map.minFilter = THREE.LinearMipmapLinearFilter;
        shared.map.generateMipmaps = true;
        shared.map.anisotropy = 4;
        shared.map.needsUpdate = true;
      }
      sharedMaterials.set(kitKey, shared);
      return;
    }

    const current = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of current) {
      if (mat === shared || seen.has(mat)) continue;
      seen.add(mat);
      mat.map?.dispose();
      mat.dispose();
    }
    node.material = shared;
  });
}

/**
 * Loads a GLB once and caches the parsed scene as a template.
 * Callers get a cheap `clone()` that keeps sharing geometry and material.
 */
export function loadModel(path) {
  let pending = templates.get(path);
  if (!pending) {
    const kitKey = kitKeyFor(path);
    pending = new Promise((resolve, reject) => {
      loader.load(
        encodeURI(path),
        (gltf) => {
          const root = gltf.scene;
          adoptSharedMaterial(root, kitKey);
          root.traverse((node) => {
            if (!node.isMesh) return;
            node.castShadow = true;
            node.receiveShadow = true;
            node.frustumCulled = true;
          });
          resolve(root);
        },
        undefined,
        reject
      );
    });
    templates.set(path, pending);
  }
  return pending.then((template) => template.clone(true));
}

/** Preloads models and reports progress (0..1); never rejects on a single failure. */
export async function preloadModels(paths, onProgress) {
  const unique = [...new Set(paths)];
  let done = 0;
  const results = await Promise.all(
    unique.map((p) =>
      loadModel(p)
        .then(() => true)
        .catch((err) => {
          console.warn(`[assets] failed to load ${p}`, err);
          return false;
        })
        .finally(() => {
          done += 1;
          onProgress?.(done / unique.length, done, unique.length);
        })
    )
  );
  return results.every(Boolean);
}

export function getSharedMaterial(kitPath) {
  return sharedMaterials.get(kitKeyFor(kitPath)) ?? null;
}

/**
 * Flattens a loaded template into one geometry + material usable by InstancedMesh.
 * World transforms of the source nodes are baked into the geometry.
 */
export function flattenToGeometry(root) {
  root.updateWorldMatrix(true, true);
  const meshes = [];
  root.traverse((node) => { if (node.isMesh && node.geometry) meshes.push(node); });
  if (!meshes.length) return null;

  const inverseRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();

  if (meshes.length === 1) {
    const geometry = meshes[0].geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().copy(meshes[0].matrixWorld).premultiply(inverseRoot));
    return { geometry, material: meshes[0].material };
  }

  // Manual concat keeps this dependency-free (no BufferGeometryUtils import).
  const parts = meshes.map((mesh) => {
    const geometry = mesh.geometry.clone().toNonIndexed();
    geometry.applyMatrix4(new THREE.Matrix4().copy(mesh.matrixWorld).premultiply(inverseRoot));
    return geometry;
  });

  const attributeNames = ['position', 'normal', 'uv'];
  const totals = {};
  for (const name of attributeNames) {
    if (!parts[0].attributes[name]) continue;
    totals[name] = parts.reduce((sum, g) => sum + (g.attributes[name]?.count ?? 0), 0);
  }

  const merged = new THREE.BufferGeometry();
  for (const [name, count] of Object.entries(totals)) {
    const itemSize = parts[0].attributes[name].itemSize;
    const array = new Float32Array(count * itemSize);
    let offset = 0;
    for (const part of parts) {
      const attr = part.attributes[name];
      if (!attr) continue;
      array.set(attr.array, offset);
      offset += attr.array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }
  merged.computeBoundingSphere();
  parts.forEach((g) => g.dispose());
  return { geometry: merged, material: meshes[0].material };
}
