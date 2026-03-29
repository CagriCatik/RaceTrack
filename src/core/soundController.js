import * as THREE from 'three';

function createNoiseBuffer(audioCtx, seconds = 2) {
  const length = Math.floor(audioCtx.sampleRate * seconds);
  const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function createSoundController(car, domElement = window) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return { update: () => {}, isReady: () => false };

  const audioCtx = new AudioCtx();
  const noiseBuffer = createNoiseBuffer(audioCtx);

  const master = audioCtx.createGain();
  master.gain.value = 0.22;
  master.connect(audioCtx.destination);

  // Engine tone
  const engineOscA = audioCtx.createOscillator();
  engineOscA.type = 'sawtooth';
  engineOscA.frequency.value = 70;

  const engineOscB = audioCtx.createOscillator();
  engineOscB.type = 'triangle';
  engineOscB.frequency.value = 141;

  const engineFilter = audioCtx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 650;
  engineFilter.Q.value = 0.35;

  const engineGain = audioCtx.createGain();
  engineGain.gain.value = 0.0001;

  engineOscA.connect(engineFilter);
  engineOscB.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(master);

  // Road noise
  const roadSrc = audioCtx.createBufferSource();
  roadSrc.buffer = noiseBuffer;
  roadSrc.loop = true;

  const roadHP = audioCtx.createBiquadFilter();
  roadHP.type = 'highpass';
  roadHP.frequency.value = 80;

  const roadLP = audioCtx.createBiquadFilter();
  roadLP.type = 'lowpass';
  roadLP.frequency.value = 900;

  const roadGain = audioCtx.createGain();
  roadGain.gain.value = 0.0001;

  roadSrc.connect(roadHP);
  roadHP.connect(roadLP);
  roadLP.connect(roadGain);
  roadGain.connect(master);

  // Skid noise
  const skidSrc = audioCtx.createBufferSource();
  skidSrc.buffer = noiseBuffer;
  skidSrc.loop = true;

  const skidBP = audioCtx.createBiquadFilter();
  skidBP.type = 'bandpass';
  skidBP.frequency.value = 1500;
  skidBP.Q.value = 0.75;

  const skidGain = audioCtx.createGain();
  skidGain.gain.value = 0.0001;

  skidSrc.connect(skidBP);
  skidBP.connect(skidGain);
  skidGain.connect(master);

  engineOscA.start();
  engineOscB.start();
  roadSrc.start();
  skidSrc.start();

  let unlocked = false;
  const unlock = () => {
    audioCtx.resume().then(() => {
      unlocked = true;
    }).catch(() => {});
  };

  domElement.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  window.addEventListener('touchstart', unlock, { passive: true });

  function update(_dt, controlKeys) {
    if (!unlocked || audioCtx.state !== 'running') return;

    const throttle = controlKeys.has('ArrowUp') || controlKeys.has('KeyW');
    const braking = controlKeys.has('ArrowDown') || controlKeys.has('KeyS');
    const speedNorm = THREE.MathUtils.clamp(Math.abs(car.speed) / car.maxSpeed, 0, 1);
    const rpm = THREE.MathUtils.clamp(speedNorm * 0.85 + (throttle ? 0.28 : 0), 0, 1);
    const skid = car.isSkidding ? 1 : THREE.MathUtils.clamp((Math.abs(car.lateralG) - 0.18) * 3.2, 0, 1);

    const now = audioCtx.currentTime;
    const engineBaseHz = 62 + rpm * 165;
    engineOscA.frequency.setTargetAtTime(engineBaseHz, now, 0.05);
    engineOscB.frequency.setTargetAtTime(engineBaseHz * 2.02, now, 0.05);
    engineFilter.frequency.setTargetAtTime(420 + rpm * 1700, now, 0.06);
    engineGain.gain.setTargetAtTime(0.015 + speedNorm * 0.07 + (throttle ? 0.03 : 0), now, 0.08);

    roadLP.frequency.setTargetAtTime(500 + speedNorm * 1400, now, 0.06);
    roadGain.gain.setTargetAtTime(0.005 + speedNorm * 0.05 + (braking ? 0.01 : 0), now, 0.1);

    skidBP.frequency.setTargetAtTime(1100 + speedNorm * 1400, now, 0.03);
    skidGain.gain.setTargetAtTime(skid * 0.1, now, 0.03);
  }

  return {
    update,
    isReady: () => unlocked && audioCtx.state === 'running',
  };
}
