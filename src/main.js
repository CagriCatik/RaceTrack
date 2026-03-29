import { pressedKeys } from './input.js';
import { createAutopilotController } from './core/autopilotController.js?v=unified-20260329-22';
import { createCameraController } from './core/cameraController.js';
import { createCollisionSystem } from './core/collisionSystem.js';
import { createGameLoop } from './core/gameLoop.js';
import { createGhostReplayController } from './core/ghostReplayController.js?v=unified-20260329-22';
import { createLapController } from './core/lapController.js?v=unified-20260329-22';
import { createAIRivalsController } from './core/aiRivalsController.js?v=unified-20260329-22';
import { createMinimapController } from './core/minimapController.js?v=unified-20260329-22';
import { createRenderer, resizeRenderer } from './core/renderer.js';
import { createSoundController } from './core/soundController.js?v=unified-20260329-22';
import { createTuningPanel } from './core/tuningPanel.js';
import { createWaypointDebugController } from './core/waypointDebugController.js?v=unified-20260329-22';
import { createScene } from './scene.js?v=unified-20260329-22';
import Vehicle from './Vehicle.js?v=unified-20260329-22';

const canvas = document.getElementById('canvas');
if (!canvas) {
  throw new Error('Canvas element with id "canvas" was not found.');
}

const renderer = createRenderer(canvas);

let scene;
let camera;
let car;
let collisionSystem;
let cameraController;
let autopilotController;
let soundController;
let waypointDebugController;
let lapController;
let tuningPanel;
let ghostReplayController;
let aiRivalsController;
let minimapController;
let updateSceneEffects = null;
let streetLightsController = null;
let setDarkEnvironment = null;
let darkEnvironment = true;
let lightSystemEnabled = true;
let lightToggleHeld = false;
let weatherToggleHeld = false;
let rivalsToggleHeld = false;
let ghostToggleHeld = false;

function spawnRivalCars(sceneRef, waypoints, count = 2) {
  if (!Array.isArray(waypoints) || waypoints.length < 4) return [];
  const rivals = [];
  const laneOffsets = [-1.1, 1.1, -0.5, 0.5];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor((0.12 + i * 0.48) * waypoints.length) % waypoints.length;
    const nextIdx = (idx + 1) % waypoints.length;
    const current = waypoints[idx];
    const next = waypoints[nextIdx];
    const dx = next.x - current.x;
    const dz = next.z - current.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    const laneOffset = laneOffsets[i % laneOffsets.length];

    const rival = new Vehicle(undefined, {
      dynamics: { maxSpeed: 15.5 + i * 0.8 },
      lights: { tuning: { frontZ: 0.01, rearZ: -0.01 } },
    });
    rival.group.position.set(current.x + nx * laneOffset, 0, current.z + nz * laneOffset);
    const heading = Math.atan2(dx, dz);
    rival.group.rotation.y = heading;
    rival.heading = heading;
    rival.speed = 0;
    rival.setLightSystemEnabled(false);
    sceneRef.add(rival.group);
    rivals.push(rival);
  }
  return rivals;
}

function createHud() {
  const hud = document.createElement('div');
  hud.style.position = 'fixed';
  hud.style.left = '12px';
  hud.style.top = '10px';
  hud.style.padding = '6px 10px';
  hud.style.background = 'rgba(0, 0, 0, 0.45)';
  hud.style.color = '#e8f8ff';
  hud.style.font = '12px/1.2 monospace';
  hud.style.border = '1px solid rgba(160, 220, 255, 0.4)';
  hud.style.borderRadius = '4px';
  hud.style.zIndex = '10';
  document.body.appendChild(hud);
  return hud;
}

async function init() {
  const sceneBundle = await createScene();
  scene = sceneBundle.scene;
  camera = sceneBundle.camera;
  car = sceneBundle.car;
  streetLightsController = sceneBundle.streetLightsController ?? null;
  setDarkEnvironment = typeof sceneBundle.setDarkEnvironment === 'function'
    ? sceneBundle.setDarkEnvironment
    : null;
  darkEnvironment = typeof sceneBundle.isDarkEnvironment === 'function'
    ? sceneBundle.isDarkEnvironment()
    : true;
  updateSceneEffects = typeof sceneBundle.updateSceneEffects === 'function'
    ? sceneBundle.updateSceneEffects
    : null;
  autopilotController = createAutopilotController(car, sceneBundle.waypoints || []);
  waypointDebugController = createWaypointDebugController(sceneBundle.waypointDebugObjects || [], false);
  lapController = createLapController(
    car,
    sceneBundle.finishLine,
    sceneBundle.waypoints || [],
    { trackWidth: sceneBundle.roadWidth }
  );
  const rivals = spawnRivalCars(scene, sceneBundle.waypoints || [], 2);
  aiRivalsController = createAIRivalsController(rivals, sceneBundle.waypoints || []);
  aiRivalsController.setEnabled(false);
  ghostReplayController = createGhostReplayController(scene, car);
  minimapController = createMinimapController(sceneBundle.waypoints || [], car, rivals);

  collisionSystem = createCollisionSystem(car, sceneBundle.obstacles);
  cameraController = createCameraController(camera, renderer.domElement, car.group);
  soundController = createSoundController(car, renderer.domElement);
  tuningPanel = createTuningPanel(car);
  lightSystemEnabled = car?.lightsEnabled ?? true;
  if (car?.setLightSystemEnabled) car.setLightSystemEnabled(lightSystemEnabled);
  if (streetLightsController?.setEnabled) streetLightsController.setEnabled(lightSystemEnabled);
  if (setDarkEnvironment) setDarkEnvironment(darkEnvironment);
  const hud = createHud();

  window.addEventListener('resize', onResize, false);

  const loop = createGameLoop({
    onUpdate: (dt) => {
      const lightTogglePressed = pressedKeys.has('KeyL');
      if (lightTogglePressed && !lightToggleHeld) {
        lightSystemEnabled = !lightSystemEnabled;
        if (car?.setLightSystemEnabled) car.setLightSystemEnabled(lightSystemEnabled);
        if (streetLightsController?.setEnabled) streetLightsController.setEnabled(lightSystemEnabled);
      }
      lightToggleHeld = lightTogglePressed;

      const weatherTogglePressed = pressedKeys.has('KeyN');
      if (weatherTogglePressed && !weatherToggleHeld) {
        darkEnvironment = !darkEnvironment;
        if (setDarkEnvironment) setDarkEnvironment(darkEnvironment);
      }
      weatherToggleHeld = weatherTogglePressed;

      const rivalsTogglePressed = pressedKeys.has('KeyO');
      if (rivalsTogglePressed && !rivalsToggleHeld && aiRivalsController) {
        aiRivalsController.setEnabled(!aiRivalsController.isEnabled());
      }
      rivalsToggleHeld = rivalsTogglePressed;

      const ghostTogglePressed = pressedKeys.has('KeyG');
      if (ghostTogglePressed && !ghostToggleHeld && ghostReplayController) {
        ghostReplayController.setVisible(!ghostReplayController.isVisible());
      }
      ghostToggleHeld = ghostTogglePressed;

      const controlKeys = autopilotController
        ? autopilotController.update(dt, pressedKeys)
        : pressedKeys;
      if (waypointDebugController) waypointDebugController.update(pressedKeys);
      car.update(dt, controlKeys);
      if (aiRivalsController) aiRivalsController.update(dt);
      collisionSystem.update();
      cameraController.update(dt);
      if (soundController) soundController.update(dt, controlKeys);
      if (lapController) lapController.update(dt);
      if (lapController && ghostReplayController) {
        const events = lapController.consumeEvents();
        for (const event of events) ghostReplayController.registerLapEvent(event);
      }
      if (ghostReplayController) ghostReplayController.update(dt);
      if (updateSceneEffects) updateSceneEffects(dt);
    },
    onRender: () => {
      if (minimapController) minimapController.update(pressedKeys);
      const lapText = lapController?.hudText?.() || '';
      const bestText = lapController?.topTimesText?.() || 'Best: --';
      const soundState = soundController?.isReady?.() ? 'ON' : 'OFF';
      const wpDebugState = waypointDebugController?.isVisible?.() ? 'ON' : 'OFF';
      const autoState = autopilotController?.isEnabled?.() ? 'ON' : 'OFF';
      const rivalsState = aiRivalsController?.isEnabled?.() ? 'ON' : 'OFF';
      const ghostState = ghostReplayController?.isVisible?.() ? 'ON' : 'OFF';
      const ghostReady = ghostReplayController?.hasGhost?.() ? 'READY' : 'NONE';
      const minimapState = minimapController?.isVisible?.() ? 'ON' : 'OFF';
      const racingLineState = minimapController?.isRacingLineVisible?.() ? 'ON' : 'OFF';
      const wpIndex = autopilotController?.currentWaypointIndex?.() ?? 0;
      const wpError = autopilotController?.lateralError?.() ?? 0;
      const tuneState = tuningPanel?.isVisible?.() ? 'ON' : 'OFF';
      const lightsState = lightSystemEnabled ? 'ON' : 'OFF';
      const weatherState = darkEnvironment ? 'DARK' : 'LIGHT';
      hud.textContent = `${lapText} | ${bestText} | Autodrive: ${autoState} (P) | Rivals: ${rivalsState} (O) | Ghost: ${ghostState}/${ghostReady} (G) | Minimap: ${minimapState} (M) | Line: ${racingLineState} (R) | Lights: ${lightsState} (L) | Weather: ${weatherState} (N) | Sound: ${soundState} | Tune: ${tuneState} (T) | WP Debug: ${wpDebugState} (V) | WP ${wpIndex + 1} | PathErr ${wpError.toFixed(2)}m`;
      renderer.render(scene, camera);
    },
    fixedDelta: 1 / 120,
    maxSubSteps: 12,
  });
  loop.start();
}

function onResize() {
  if (!camera) return;
  resizeRenderer(renderer, camera);
}

init().catch((err) => {
  console.error('Failed to initialize scene:', err);
});






