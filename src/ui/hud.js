/**
 * Telemetry panel.
 *
 * The old HUD rebuilt a ~300 character template string into `textContent` on *every*
 * rendered frame — 20 interpolations, a full layout and a style recalc per frame, for
 * values that change a few times a second. This writes into prepared nodes, only when
 * a value actually changed, and at 12 Hz.
 */
const UPDATE_HZ = 12;

export function createHud(root) {
  const el = {
    speed: root.querySelector('#hud-speed'),
    gauge: root.querySelector('#hud-gauge-fill'),
    lap: root.querySelector('#hud-lap'),
    time: root.querySelector('#hud-time'),
    best: root.querySelector('#hud-best'),
    valid: root.querySelector('#hud-valid'),
    chips: root.querySelector('#hud-chips'),
    labels: {
      lap: root.querySelector('#hud-lap-label'),
      time: root.querySelector('#hud-time-label'),
      best: root.querySelector('#hud-best-label'),
      valid: root.querySelector('#hud-valid-label'),
    },
  };

  const chipDefs = [
    ['cam', 'CAM'],
    ['auto', 'AUTO P'],
    ['rivals', 'KI O'],
    ['ghost', 'GHOST G'],
    ['map', 'MAP M'],
    ['line', 'LINE R'],
    ['lights', 'LICHT L'],
    ['weather', 'NACHT N'],
    ['sound', 'SOUND'],
    ['tune', 'TUNE T'],
  ];

  const chips = new Map();
  for (const [key, label] of chipDefs) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = label;
    el.chips.appendChild(chip);
    chips.set(key, { node: chip, label, on: null, text: label });
  }

  const last = {};
  let timer = 0;

  function writeText(node, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    node.textContent = value;
  }

  function setChip(key, on, label) {
    const chip = chips.get(key);
    if (!chip) return;
    const text = label ?? chip.label;
    if (chip.text !== text) {
      chip.text = text;
      chip.node.textContent = text;
    }
    if (chip.on === on) return;
    chip.on = on;
    chip.node.classList.toggle('is-on', !!on);
  }

  function update(frameDt, state) {
    timer += frameDt;
    if (timer < 1 / UPDATE_HZ) return;
    timer = 0;

    const kmh = Math.max(0, Math.round(Math.abs(state.speedKmh)));
    writeText(el.speed, 'speed', String(kmh));

    const ratio = Math.min(1, Math.abs(state.speedKmh) / Math.max(state.maxKmh, 1));
    const pct = `${(ratio * 100).toFixed(0)}%`;
    if (last.gauge !== pct) {
      last.gauge = pct;
      el.gauge.style.width = pct;
    }

    writeText(el.lap, 'lap', String(state.lap));
    writeText(el.time, 'time', state.time);
    writeText(el.best, 'best', state.best);
    const validText = state.validText ?? (state.valid ? 'OK' : 'CUT');
    writeText(el.valid, 'valid', validText);
    if (last.validClass !== state.valid) {
      last.validClass = state.valid;
      el.valid.classList.toggle('is-bad', !state.valid);
      el.valid.classList.toggle('is-good', !!state.valid);
    }

    setChip('cam', true, state.cameraMode);
    setChip('auto', state.autopilot);
    setChip('rivals', state.rivals);
    setChip('ghost', state.ghost, state.ghostReady ? 'GHOST G' : 'GHOST —');
    setChip('map', state.minimap);
    setChip('line', state.racingLine);
    setChip('lights', state.lights);
    setChip('weather', state.dark);
    setChip('sound', state.sound);
    setChip('tune', state.tuning);
  }

  return {
    update,
    /** Free roam shows distance and top speed where the lap stats would be. */
    setLabels(labels) {
      for (const [slot, text] of Object.entries(labels)) {
        if (el.labels[slot]) el.labels[slot].textContent = text;
      }
    },
    /** Hides chips that make no sense in the current mode. */
    hideChips(keys) {
      for (const key of keys) chips.get(key)?.node.remove();
    },
    show() { root.hidden = false; },
    hide() { root.hidden = true; },
  };
}

/** Transient lap messages. */
export function createToast(node) {
  let hideTimer = 0;

  function show(message, variant = '', duration = 2600) {
    clearTimeout(hideTimer);
    node.textContent = message;
    node.className = `toast is-visible${variant ? ` is-${variant}` : ''}`;
    node.hidden = false;
    hideTimer = setTimeout(() => {
      node.classList.remove('is-visible');
      hideTimer = setTimeout(() => { node.hidden = true; }, 240);
    }, duration);
  }

  return { show };
}

/** `F` toggles a small renderer.info readout — useful to verify the draw-call budget. */
export function createPerfOverlay(renderer, loopStats) {
  const node = document.createElement('div');
  node.className = 'panel perf';
  node.hidden = true;
  document.body.appendChild(node);

  let visible = false;
  let timer = 0;

  function update(frameDt) {
    if (!visible) return;
    timer += frameDt;
    if (timer < 0.25) return;
    timer = 0;
    const info = renderer.info;
    node.textContent =
      `${loopStats.fps.toFixed(0)} fps   ${loopStats.frameMs.toFixed(1)} ms\n` +
      `draws  ${info.render.calls}\n` +
      `tris   ${(info.render.triangles / 1000).toFixed(1)}k\n` +
      `geom   ${info.memory.geometries}   tex ${info.memory.textures}\n` +
      `steps  ${loopStats.steps}   progs ${info.programs?.length ?? 0}`;
  }

  return {
    update,
    toggle() {
      visible = !visible;
      node.hidden = !visible;
      return visible;
    },
    isVisible: () => visible,
  };
}
