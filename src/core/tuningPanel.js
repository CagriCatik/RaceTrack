import * as THREE from 'three';

const STORAGE_KEY = 'car-game.tuning-preset.v1';

function createPanelRoot() {
  const root = document.createElement('div');
  root.style.position = 'fixed';
  root.style.right = '12px';
  root.style.top = '12px';
  root.style.width = '300px';
  root.style.maxHeight = '78vh';
  root.style.overflowY = 'auto';
  root.style.padding = '10px';
  root.style.background = 'rgba(6, 10, 16, 0.84)';
  root.style.border = '1px solid rgba(125, 182, 255, 0.35)';
  root.style.borderRadius = '8px';
  root.style.color = '#d9e9ff';
  root.style.font = '12px/1.35 monospace';
  root.style.zIndex = '15';
  root.style.display = 'none';
  return root;
}

function formatValue(v) {
  if (!Number.isFinite(v)) return '--';
  if (Math.abs(v) >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

export function createTuningPanel(car) {
  const root = createPanelRoot();
  document.body.appendChild(root);

  const title = document.createElement('div');
  title.textContent = 'Vehicle Tuning (T to toggle)';
  title.style.fontWeight = '700';
  title.style.marginBottom = '8px';
  root.appendChild(title);

  const controls = new Map();
  const lightTuning = { ...car.lightMountTuning };

  function section(name) {
    const el = document.createElement('div');
    el.textContent = name;
    el.style.margin = '10px 0 6px';
    el.style.opacity = '0.92';
    el.style.color = '#9cc6ff';
    root.appendChild(el);
  }

  function addSlider({ id, label, min, max, step, get, set }) {
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '6px';
    root.appendChild(wrap);

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.gap = '8px';
    wrap.appendChild(row);

    const left = document.createElement('span');
    left.textContent = label;
    row.appendChild(left);

    const right = document.createElement('span');
    right.style.color = '#e8f4ff';
    row.appendChild(right);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.style.width = '100%';
    input.style.margin = '2px 0 0';
    wrap.appendChild(input);

    const setUI = (value) => {
      input.value = String(value);
      right.textContent = formatValue(value);
    };

    const apply = (value) => {
      set(value);
      setUI(get());
    };

    input.addEventListener('input', () => apply(parseFloat(input.value)));
    setUI(get());
    controls.set(id, { get, set: apply, setUI });
  }

  section('Dynamics');
  addSlider({
    id: 'maxSpeed',
    label: 'Max speed',
    min: 8,
    max: 35,
    step: 0.1,
    get: () => car.maxSpeed,
    set: (v) => { car.maxSpeed = v; },
  });
  addSlider({
    id: 'accelRate',
    label: 'Acceleration',
    min: 4,
    max: 20,
    step: 0.1,
    get: () => car.accelRate,
    set: (v) => { car.accelRate = v; },
  });
  addSlider({
    id: 'brakeRate',
    label: 'Brake rate',
    min: 6,
    max: 32,
    step: 0.1,
    get: () => car.brakeRate,
    set: (v) => { car.brakeRate = v; },
  });
  addSlider({
    id: 'gripLimit',
    label: 'Grip limit',
    min: 4,
    max: 24,
    step: 0.1,
    get: () => car.gripLimit,
    set: (v) => { car.gripLimit = v; },
  });
  addSlider({
    id: 'maxSteerDeg',
    label: 'Max steer deg',
    min: 12,
    max: 45,
    step: 0.5,
    get: () => car.maxSteerDeg,
    set: (v) => {
      car.maxSteerDeg = v;
      car.maxSteer = THREE.MathUtils.degToRad(v);
    },
  });

  section('Suspension');
  addSlider({
    id: 'suspK',
    label: 'Spring',
    min: 8,
    max: 56,
    step: 0.2,
    get: () => car.suspK,
    set: (v) => { car.suspK = v; },
  });
  addSlider({
    id: 'suspDamp',
    label: 'Damp half-life',
    min: 0.03,
    max: 0.4,
    step: 0.005,
    get: () => car.suspDamp,
    set: (v) => { car.suspDamp = v; },
  });
  addSlider({
    id: 'suspRange',
    label: 'Travel',
    min: 0.02,
    max: 0.2,
    step: 0.002,
    get: () => car.suspRange,
    set: (v) => { car.suspRange = v; },
  });

  section('Light Anchors');
  for (const key of ['frontX', 'frontY', 'frontZ', 'rearX', 'rearY', 'rearZ']) {
    addSlider({
      id: `light_${key}`,
      label: key,
      min: -0.35,
      max: 0.35,
      step: 0.005,
      get: () => lightTuning[key],
      set: (v) => {
        lightTuning[key] = v;
        car.updateLightMountTuning({ [key]: v });
      },
    });
  }

  const buttons = document.createElement('div');
  buttons.style.display = 'grid';
  buttons.style.gridTemplateColumns = '1fr 1fr 1fr';
  buttons.style.gap = '6px';
  buttons.style.marginTop = '10px';
  root.appendChild(buttons);

  const createButton = (label, onClick) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.padding = '5px 6px';
    b.style.background = '#13263e';
    b.style.color = '#cde6ff';
    b.style.border = '1px solid #34597f';
    b.style.borderRadius = '4px';
    b.style.cursor = 'pointer';
    b.addEventListener('click', onClick);
    buttons.appendChild(b);
    return b;
  };

  const defaultPreset = {
    maxSpeed: car.config.dynamics.maxSpeed,
    accelRate: car.config.dynamics.accelRate,
    brakeRate: car.config.dynamics.brakeRate,
    gripLimit: car.config.dynamics.gripLimit,
    maxSteerDeg: car.config.dynamics.maxSteerDeg,
    suspK: car.config.suspension.spring,
    suspDamp: car.config.suspension.dampingHalfLife,
    suspRange: car.config.suspension.travel,
    lights: { ...car.config.lights.tuning },
  };

  const collectPreset = () => ({
    maxSpeed: car.maxSpeed,
    accelRate: car.accelRate,
    brakeRate: car.brakeRate,
    gripLimit: car.gripLimit,
    maxSteerDeg: car.maxSteerDeg,
    suspK: car.suspK,
    suspDamp: car.suspDamp,
    suspRange: car.suspRange,
    lights: { ...lightTuning },
  });

  const applyPreset = (preset) => {
    if (!preset) return;

    const numericKeys = [
      'maxSpeed',
      'accelRate',
      'brakeRate',
      'gripLimit',
      'maxSteerDeg',
      'suspK',
      'suspDamp',
      'suspRange',
    ];
    for (const key of numericKeys) {
      const c = controls.get(key);
      const value = preset[key];
      if (!c || !Number.isFinite(value)) continue;
      c.set(value);
    }

    if (preset.lights && typeof preset.lights === 'object') {
      for (const k of Object.keys(lightTuning)) {
        const value = preset.lights[k];
        if (!Number.isFinite(value)) continue;
        const c = controls.get(`light_${k}`);
        if (!c) continue;
        c.set(value);
      }
    }
  };

  createButton('Save', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collectPreset()));
  });
  createButton('Load', () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      applyPreset(JSON.parse(raw));
    } catch {
      // Ignore malformed local presets.
    }
  });
  createButton('Reset', () => {
    applyPreset(defaultPreset);
  });

  const footer = document.createElement('div');
  footer.textContent = 'Saved in browser localStorage.';
  footer.style.opacity = '0.72';
  footer.style.marginTop = '8px';
  root.appendChild(footer);

  const rawPreset = localStorage.getItem(STORAGE_KEY);
  if (rawPreset) {
    try {
      applyPreset(JSON.parse(rawPreset));
    } catch {
      // Ignore malformed local presets.
    }
  }

  let visible = false;
  const onKeyDown = (e) => {
    if (e.code !== 'KeyT') return;
    visible = !visible;
    root.style.display = visible ? 'block' : 'none';
  };
  window.addEventListener('keydown', onKeyDown);

  return {
    isVisible: () => visible,
    destroy: () => {
      window.removeEventListener('keydown', onKeyDown);
      root.remove();
    },
  };
}
