import * as THREE from 'three';

/**
 * The scene leans hard on emissive lamps and spotlights. Without tone mapping those
 * clip to flat white; ACES filmic keeps the highlights readable and the night mood
 * intact. `powerPreference` asks for the discrete GPU on dual-GPU laptops.
 */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: window.devicePixelRatio < 1.5,
    powerPreference: 'high-performance',
    stencil: false,
  });

  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  return renderer;
}

/** Caps DPR: a 3x retina display costs 9x the fragments for no visible gain here. */
function pixelRatio() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

export function resizeRenderer(renderer, camera) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(width, height, false);
}

/** Debounced resize wiring; returns a disposer. */
export function attachResizeHandler(renderer, getCamera) {
  let frame = 0;
  const onResize = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const camera = getCamera();
      if (camera) resizeRenderer(renderer, camera);
    });
  };
  window.addEventListener('resize', onResize);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', onResize);
  };
}
