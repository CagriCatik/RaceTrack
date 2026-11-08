import { endFrame, pressedKeys, wasPressed } from './input.js';
import { RIVAL_CARS } from './config/carCatalog.js';
import { TILE } from './config/cityCatalog.js';
import { createAIRivalsController } from './core/aiRivalsController.js';
import { createAutopilotController } from './core/autopilotController.js';
import { createCameraController } from './core/cameraController.js';
import { createCollisionSystem } from './core/collisionSystem.js';
import { createGameLoop } from './core/gameLoop.js';
import { createGhostReplayController } from './core/ghostReplayController.js';
import { createLapController, formatLapTime } from './core/lapController.js';
import { createMinimapController } from './core/minimapController.js';
import { attachResizeHandler, createRenderer } from './core/renderer.js';
import { createSoundController } from './core/soundController.js';
import { createTuningPanel } from './core/tuningPanel.js';
import { createWaypointDebugController } from './core/waypointDebugController.js';
import { createScene } from './scene/createScene.js';
import { createHud, createPerfOverlay, createToast } from './ui/hud.js';
import { createStartOverlay } from './ui/startOverlay.js';

const dom = {
  canvas: document.getElementById('canvas'),
  hud: document.getElementById('hud'),
  help: document.getElementById('help'),
  minimap: document.getElementById('minimap'),
  toast: document.getElementById('toast'),
  start: document.getElementById('start'),
};

if (!dom.canvas) throw new Error('Canvas element with id "canvas" was not found.');

const RIVAL_COUNT = 3;

async function main() {
  const renderer = createRenderer(dom.canvas);
  const overlay = createStartOverlay(dom.start);

  // The start screen is the user gesture that lets us build the AudioContext, and the
  // moment we know which model to fetch — so world building waits for it.
  const { carId, scenario } = await overlay.waitForStart(
    RIVAL_CARS.slice(0, RIVAL_COUNT).map((r) => r.id)
  );

  const world = await createScene({ carId, rivalCount: RIVAL_COUNT, scenario });
  const { scene, camera, car, rivals } = world;
  renderer.toneMappingExposure = world.exposure();

  const disposeResize = attachResizeHandler(renderer, () => camera);

  // ── Systems
  const freeRoam = !!world.freeRoam;

  const cameraController = createCameraController(camera, renderer.domElement, car);
  const autopilot = createAutopilotController(car, world.racingPath);
  const aiRivals = createAIRivalsController(rivals, world.racingPath, car);
  // No start/finish gate in free roam, so there is nothing to time.
  const lap = freeRoam
    ? null
    : createLapController(car, world.finishLine, world.centerPath, { trackWidth: world.roadWidth });
  const ghost = freeRoam ? null : createGhostReplayController(scene, car, camera);
  const minimap = createMinimapController(dom.minimap, world.racingWaypoints, car, rivals, {
    cityCells: freeRoam ? world.cityCells : null,
    tile: TILE,
  });
  const waypointDebug = createWaypointDebugController(world.waypointDebugGroup);
  const tuning = createTuningPanel(car);
  const sound = createSoundController(car);
  const collisions = createCollisionSystem(car, {
    propGroups: world.obstacles.propGroups,
    path: world.centerPath,
    roadWidth: world.roadWidth,
    cityCollider: world.cityCollider,
  });

  const hud = createHud(dom.hud);
  const toast = createToast(dom.toast);

  let lightsOn = true;
  let darkMode = world.isDarkEnvironment();
  let helpVisible = true;

  // Free roam telemetry: no laps, so the stat block becomes a trip computer.
  let odometer = 0;
  let topSpeedKmh = 0;
  let driveSeconds = 0;

  if (freeRoam) {
    hud.setLabels({ lap: 'Distance', time: 'Elapsed', best: 'Top', valid: 'Mode' });
    hud.hideChips(['ghost']);
  }

  aiRivals.setEnabled(true);
  car.setLightSystemEnabled(lightsOn);
  world.streetLightsController.setEnabled(lightsOn && darkMode);

  collisions.on('prop', ({ impact }) => sound.impact(impact * 0.4));
  collisions.on('wall', ({ speed }) => sound.impact(speed * 0.25));

  // ── Loop
  const loop = createGameLoop({
    fixedDelta: 1 / 60,
    maxSubSteps: 5,

    onUpdate(dt) {
      const controlKeys = autopilot.update(dt, pressedKeys);
      car.update(dt, controlKeys);
      aiRivals.update(dt);
      collisions.update();
      if (lap) lap.update(dt);
      else {
        odometer += Math.abs(car.speed) * dt;
        driveSeconds += dt;
        const kmh = Math.abs(car.speedKmh);
        if (kmh > topSpeedKmh) topSpeedKmh = kmh;
      }
      lastControlKeys = controlKeys;
    },

    onRender(frameDt) {
      handleToggles();

      cameraController.update(frameDt);
      car.updateVisuals(frameDt);
      aiRivals.updateVisuals(frameDt);
      collisions.updateProps(frameDt);
      world.updateWeather(frameDt);
      world.streetLightsController.update(frameDt, car.group.position);
      ghost?.update(frameDt);
      minimap.update(frameDt);
      sound.update(frameDt, lastControlKeys);

      if (lap) {
        for (const event of lap.consumeEvents()) {
          ghost?.registerLapEvent(event);
          announceLap(event);
        }
      }

      hud.update(frameDt, {
        speedKmh: car.speedKmh,
        maxKmh: car.maxSpeed * 3.6,
        lap: lap ? lap.lapCount() : `${(odometer / 1000).toFixed(2)} km`,
        time: lap ? lap.currentTimeText() : formatClock(driveSeconds),
        best: lap ? lap.bestTimeText() : `${Math.round(topSpeedKmh)} km/h`,
        valid: lap ? lap.isCurrentLapValid() : true,
        validText: lap ? undefined : 'FREE',
        cameraMode: cameraController.modeLabel(),
        autopilot: autopilot.isEnabled(),
        rivals: aiRivals.isEnabled(),
        ghost: ghost ? ghost.isVisible() : false,
        ghostReady: ghost ? ghost.hasGhost() : false,
        minimap: minimap.isVisible(),
        racingLine: minimap.isRacingLineVisible(),
        lights: lightsOn,
        dark: darkMode,
        sound: sound.isReady(),
        tuning: tuning.isVisible(),
      });

      // Reset before rendering so renderer.info holds *this* frame's counts and stays
      // readable afterwards (handy for the perf overlay and for window.__race probes).
      renderer.info.reset();
      renderer.render(scene, camera);
      perf.update(frameDt);
      endFrame();
    },
  });

  const perf = createPerfOverlay(renderer, loop.stats);
  let lastControlKeys = pressedKeys;

  function handleToggles() {
    tuning.update();
    waypointDebug.update();

    if (wasPressed('KeyL')) {
      lightsOn = !lightsOn;
      car.setLightSystemEnabled(lightsOn);
      world.streetLightsController.setEnabled(lightsOn && darkMode);
    }
    if (wasPressed('KeyN')) {
      darkMode = !darkMode;
      world.setDarkEnvironment(darkMode);
      world.streetLightsController.setEnabled(lightsOn && darkMode);
      renderer.toneMappingExposure = world.exposure();
    }
    if (wasPressed('KeyP')) autopilot.toggle();
    if (wasPressed('KeyO')) aiRivals.setEnabled(!aiRivals.isEnabled());
    if (wasPressed('KeyG')) ghost?.toggle();
    if (wasPressed('KeyM')) minimap.toggle();
    if (wasPressed('KeyR')) minimap.toggleRacingLine();
    if (wasPressed('KeyF')) perf.toggle();
    if (wasPressed('KeyH')) {
      helpVisible = !helpVisible;
      dom.help.hidden = !helpVisible;
    }
    if (wasPressed('Backspace')) resetToTrack();
  }

  /** Puts the car back on the centre line (or the nearest street) facing forwards. */
  function resetToTrack() {
    const pos = car.group.position;

    if (freeRoam) {
      // Snap to the closest street cell centre so a reset never lands inside a wall.
      let best = null;
      let bestDist = Infinity;
      for (const cell of world.cityCells.values()) {
        if (cell.type !== 'street') continue;
        const d = (cell.x - pos.x) ** 2 + (cell.z - pos.z) ** 2;
        if (d < bestDist) { bestDist = d; best = cell; }
      }
      if (best) car.resetTo(best.x, best.z, car.heading);
      toast.show('Back on the road', '', 1600);
      return;
    }

    const nearest = world.centerPath.nearest(pos.x, pos.z, -1);
    const heading = Math.atan2(nearest.tangentX, nearest.tangentZ);
    car.resetTo(nearest.x, nearest.z, heading);
    lap.invalidateLap();
    toast.show('Back on track — lap invalidated', 'invalid', 2000);
  }

  function announceLap(event) {
    if (!event.valid) {
      toast.show(`Lap invalid (${event.checkpointsOk ? 'cut the track' : 'missed a checkpoint'})`, 'invalid');
      return;
    }
    if (event.best) toast.show(`New best lap  ${formatLapTime(event.time)}`, 'best', 3200);
    else toast.show(`Lap ${lap.lapCount()}  ${formatLapTime(event.time)}`);
  }

  // ── Go
  await sound.unlock();
  hud.show();
  dom.help.hidden = false;
  overlay.close();
  loop.start();
  toast.show(
    freeRoam ? 'Free roam — press H to hide the controls' : 'Good luck — press H to hide the controls',
    '',
    4200
  );

  window.addEventListener('beforeunload', () => {
    loop.stop();
    disposeResize();
  });

  // Small debug handle; keeps the console useful without leaking globals everywhere.
  window.__race = { world, loop, renderer, car, lap, perf, collisions, freeRoam };
}

/** mm:ss for the free-roam trip timer. */
function formatClock(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds - mins * 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

main().catch((err) => {
  console.error('Failed to start RaceTrack:', err);
  const status = document.getElementById('start-status');
  if (status) status.textContent = `Start fehlgeschlagen: ${err.message}`;
});
