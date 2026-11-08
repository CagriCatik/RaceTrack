import * as THREE from 'three';

/**
 * Procedural engine / road / skid audio — no sample files needed.
 *
 * Notable fixes: the AudioContext is created *lazily* on the first user gesture
 * (Chrome logs a warning and Safari refuses outright otherwise), the noise buffer is
 * shared by both noise voices instead of being generated twice, and `update` bails out
 * before touching any Web Audio parameter when the context is not running.
 */
export function createSoundController(car) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return { update() {}, unlock() {}, isReady: () => false, setMuted() {}, isMuted: () => true };
  }

  let ctx = null;
  let nodes = null;
  let muted = false;
  let collisionCooldown = 0;

  function createNoiseBuffer(audioCtx, seconds = 2) {
    const length = Math.floor(audioCtx.sampleRate * seconds);
    const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function build() {
    ctx = new AudioCtx();
    const noise = createNoiseBuffer(ctx);

    const master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);

    const engineA = ctx.createOscillator();
    engineA.type = 'sawtooth';
    engineA.frequency.value = 70;
    const engineB = ctx.createOscillator();
    engineB.type = 'triangle';
    engineB.frequency.value = 141;

    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 650;
    engineFilter.Q.value = 0.35;

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.0001;

    engineA.connect(engineFilter);
    engineB.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);

    const makeNoiseVoice = (filterType, frequency, q) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = frequency;
      if (q !== undefined) filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start();
      return { src, filter, gain };
    };

    const road = makeNoiseVoice('lowpass', 900);
    const skid = makeNoiseVoice('bandpass', 1500, 0.75);

    engineA.start();
    engineB.start();

    nodes = { master, engineA, engineB, engineFilter, engineGain, road, skid };
  }

  /** Must be called from a real user gesture. */
  function unlock() {
    if (!ctx) build();
    return ctx.resume().catch(() => {});
  }

  function update(frameDt, controlKeys) {
    if (!ctx || ctx.state !== 'running' || muted) return;
    collisionCooldown = Math.max(0, collisionCooldown - frameDt);

    const throttle = controlKeys.has('ArrowUp') || controlKeys.has('KeyW');
    const braking = controlKeys.has('ArrowDown') || controlKeys.has('KeyS') || controlKeys.has('Space');
    const speedNorm = THREE.MathUtils.clamp(Math.abs(car.speed) / car.maxSpeed, 0, 1);
    const rpm = THREE.MathUtils.clamp(speedNorm * 0.85 + (throttle ? 0.28 : 0), 0, 1);
    const skidAmount = car.isSkidding
      ? 1
      : THREE.MathUtils.clamp((Math.abs(car.lateralG) - 0.18) * 3.2, 0, 1);

    const now = ctx.currentTime;
    const engineHz = 62 + rpm * 165;
    nodes.engineA.frequency.setTargetAtTime(engineHz, now, 0.05);
    nodes.engineB.frequency.setTargetAtTime(engineHz * 2.02, now, 0.05);
    nodes.engineFilter.frequency.setTargetAtTime(420 + rpm * 1700, now, 0.06);
    nodes.engineGain.gain.setTargetAtTime(0.015 + speedNorm * 0.07 + (throttle ? 0.03 : 0), now, 0.08);

    nodes.road.filter.frequency.setTargetAtTime(500 + speedNorm * 1400, now, 0.06);
    nodes.road.gain.gain.setTargetAtTime(0.005 + speedNorm * 0.05 + (braking ? 0.01 : 0), now, 0.1);

    nodes.skid.filter.frequency.setTargetAtTime(1100 + speedNorm * 1400, now, 0.03);
    nodes.skid.gain.gain.setTargetAtTime(skidAmount * 0.1, now, 0.03);
  }

  /** Short noise burst for prop/wall contact. */
  function impact(strength = 1) {
    if (!ctx || ctx.state !== 'running' || muted || collisionCooldown > 0) return;
    collisionCooldown = 0.12;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.min(0.3, 0.08 + strength * 0.05), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(120 + Math.random() * 60, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.2);
    osc.connect(gain);
    gain.connect(nodes.master);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  return {
    update,
    unlock,
    impact,
    isReady: () => !!ctx && ctx.state === 'running' && !muted,
    setMuted(next) {
      muted = !!next;
      if (nodes) nodes.master.gain.value = muted ? 0 : 0.22;
    },
    isMuted: () => muted,
  };
}
