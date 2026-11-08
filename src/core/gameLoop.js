/**
 * Fixed-step loop with a separate render callback.
 *
 * Physics runs at `fixedDelta` (60 Hz) — the old 120 Hz step doubled the cost of every
 * controller for no perceptible gain, and `maxSubSteps: 12` allowed a 12x spike on a
 * single slow frame. Visual-only work (particles, HUD, minimap) gets `frameDt` so it
 * runs once per rendered frame instead of once per physics step.
 */
export function createGameLoop({
  onUpdate,
  onRender,
  fixedDelta = 1 / 60,
  maxSubSteps = 5,
} = {}) {
  if (typeof onUpdate !== 'function') {
    throw new Error('createGameLoop requires an onUpdate callback.');
  }

  let lastTime = 0;
  let accumulator = 0;
  let rafId = null;
  let running = false;

  const stats = { fps: 0, frameMs: 0, steps: 0, droppedFrames: 0 };
  let fpsAccum = 0;
  let fpsFrames = 0;

  function frame(nowMs) {
    rafId = requestAnimationFrame(frame);
    const now = nowMs * 0.001;

    if (lastTime === 0) {
      lastTime = now;
      onRender?.(0, stats);
      return;
    }

    let frameDt = now - lastTime;
    lastTime = now;
    if (frameDt < 0) frameDt = 0;
    if (frameDt > 0.25) {
      // Tab was in the background: skip the catch-up entirely.
      frameDt = fixedDelta;
      accumulator = 0;
      stats.droppedFrames += 1;
    }

    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= fixedDelta && steps < maxSubSteps) {
      onUpdate(fixedDelta);
      accumulator -= fixedDelta;
      steps += 1;
    }
    if (steps === maxSubSteps && accumulator >= fixedDelta) accumulator = 0;

    stats.steps = steps;
    stats.frameMs = frameDt * 1000;
    fpsAccum += frameDt;
    fpsFrames += 1;
    if (fpsAccum >= 0.5) {
      stats.fps = fpsFrames / fpsAccum;
      fpsAccum = 0;
      fpsFrames = 0;
    }

    onRender?.(frameDt, stats);
  }

  return {
    stats,
    start() {
      if (running) return;
      running = true;
      lastTime = 0;
      accumulator = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(rafId);
      rafId = null;
    },
    isRunning: () => running,
  };
}
