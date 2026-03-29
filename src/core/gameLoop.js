export function createGameLoop({
  onUpdate,
  onRender,
  fixedDelta = 1 / 120,
  maxSubSteps = 10,
} = {}) {
  if (typeof onUpdate !== 'function') {
    throw new Error('createGameLoop requires an onUpdate callback.');
  }

  let lastTime = 0;
  let accumulator = 0;
  let rafId = null;

  function frame(nowMs) {
    rafId = requestAnimationFrame(frame);
    const now = nowMs * 0.001;
    if (lastTime === 0) {
      lastTime = now;
      if (typeof onRender === 'function') {
        onRender({ alpha: 0, frameDt: 0, steps: 0 });
      }
      return;
    }

    const frameDt = Math.min(0.25, Math.max(0, now - lastTime));
    lastTime = now;
    accumulator += frameDt;

    let steps = 0;
    while (accumulator >= fixedDelta && steps < maxSubSteps) {
      onUpdate(fixedDelta);
      accumulator -= fixedDelta;
      steps += 1;
    }

    // If the tab stalled for too long, drop leftover time to avoid a long catch-up spiral.
    if (steps === maxSubSteps && accumulator >= fixedDelta) {
      accumulator = 0;
    }

    if (typeof onRender === 'function') {
      onRender({
        alpha: accumulator / fixedDelta,
        frameDt,
        steps,
      });
    }
  }

  function start() {
    if (rafId !== null) return;
    lastTime = 0;
    accumulator = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (rafId === null) return;
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  return { start, stop };
}
