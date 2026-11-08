import * as THREE from 'three';
import { wasPressed } from '../input.js';

const STORAGE_KEY = 'racetrack.tuning-preset.v2';

const formatValue = (v) => (!Number.isFinite(v) ? '--' : Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(3));

/**
 * Live vehicle tuning. Same feature set as before, but the ~90 lines of inline
 * `element.style.x = ...` assignments are gone — it uses the `.tuning` classes in
 * style.css, and the `T` toggle goes through the shared input module instead of
 * registering a second global keydown listener.
 */
export function createTuningPanel(car) {
  const root = document.createElement('section');
  root.className = 'panel tuning';
  root.hidden = true;

  const title = document.createElement('h2');
  title.textContent = 'Fahrzeug-Tuning (T)';
  root.appendChild(title);

  const controls = new Map();
  const lightTuning = { ...car.lightMountTuning };

  const section = (label) => {
    const el = document.createElement('div');
    el.className = 'tuning__section';
    el.textContent = label;
    root.appendChild(el);
  };

  function addSlider({ id, label, min, max, step, get, set }) {
    const row = document.createElement('div');
    row.className = 'tuning__row';

    const head = document.createElement('label');
    head.className = 'tuning__label';
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('b');
    head.append(name, value);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    head.htmlFor = `tune-${id}`;
    input.id = `tune-${id}`;

    row.append(head, input);
    root.appendChild(row);

    const setUI = (v) => {
      input.value = String(v);
      value.textContent = formatValue(v);
    };
    const apply = (v) => {
      set(v);
      setUI(get());
    };
    input.addEventListener('input', () => apply(parseFloat(input.value)));
    setUI(get());
    controls.set(id, { get, set: apply });
  }

  section('Dynamik');
  addSlider({ id: 'maxSpeed', label: 'Höchstgeschw.', min: 8, max: 40, step: 0.1, get: () => car.maxSpeed, set: (v) => { car.maxSpeed = v; } });
  addSlider({ id: 'accelRate', label: 'Beschleunigung', min: 4, max: 24, step: 0.1, get: () => car.accelRate, set: (v) => { car.accelRate = v; } });
  addSlider({ id: 'brakeRate', label: 'Bremskraft', min: 6, max: 34, step: 0.1, get: () => car.brakeRate, set: (v) => { car.brakeRate = v; } });
  addSlider({ id: 'gripLimit', label: 'Grip-Limit', min: 4, max: 26, step: 0.1, get: () => car.gripLimit, set: (v) => { car.gripLimit = v; } });
  addSlider({ id: 'slipFactor', label: 'Drift-Neigung', min: 0, max: 0.5, step: 0.005, get: () => car.slipFactor, set: (v) => { car.slipFactor = v; } });
  addSlider({
    id: 'maxSteerDeg', label: 'Max. Lenkwinkel', min: 12, max: 48, step: 0.5,
    get: () => car.maxSteerDeg,
    set: (v) => { car.maxSteerDeg = v; car.maxSteer = THREE.MathUtils.degToRad(v); },
  });

  section('Federung');
  addSlider({ id: 'suspK', label: 'Federrate', min: 8, max: 60, step: 0.2, get: () => car.suspK, set: (v) => { car.suspK = v; } });
  addSlider({ id: 'suspDamp', label: 'Dämpfung', min: 0.03, max: 0.4, step: 0.005, get: () => car.suspDamp, set: (v) => { car.suspDamp = v; } });
  addSlider({ id: 'suspRange', label: 'Federweg', min: 0.02, max: 0.22, step: 0.002, get: () => car.suspRange, set: (v) => { car.suspRange = v; } });

  section('Lampen-Position');
  for (const key of ['frontX', 'frontY', 'frontZ', 'rearX', 'rearY', 'rearZ']) {
    addSlider({
      id: `light_${key}`, label: key, min: -0.35, max: 0.35, step: 0.005,
      get: () => lightTuning[key],
      set: (v) => { lightTuning[key] = v; car.updateLightMountTuning({ [key]: v }); },
    });
  }

  const defaultPreset = collect(car.config);
  function collect(source) {
    const d = source.dynamics ?? source;
    const s = source.suspension ?? source;
    return {
      maxSpeed: d.maxSpeed, accelRate: d.accelRate, brakeRate: d.brakeRate,
      gripLimit: d.gripLimit, slipFactor: d.slipFactor, maxSteerDeg: d.maxSteerDeg,
      suspK: s.spring ?? car.suspK, suspDamp: s.dampingHalfLife ?? car.suspDamp,
      suspRange: s.travel ?? car.suspRange,
      lights: { ...(source.lights?.tuning ?? lightTuning) },
    };
  }

  const currentPreset = () => ({
    maxSpeed: car.maxSpeed, accelRate: car.accelRate, brakeRate: car.brakeRate,
    gripLimit: car.gripLimit, slipFactor: car.slipFactor, maxSteerDeg: car.maxSteerDeg,
    suspK: car.suspK, suspDamp: car.suspDamp, suspRange: car.suspRange,
    lights: { ...lightTuning },
  });

  function applyPreset(preset) {
    if (!preset) return;
    for (const key of ['maxSpeed', 'accelRate', 'brakeRate', 'gripLimit', 'slipFactor', 'maxSteerDeg', 'suspK', 'suspDamp', 'suspRange']) {
      const control = controls.get(key);
      if (control && Number.isFinite(preset[key])) control.set(preset[key]);
    }
    if (preset.lights) {
      for (const key of Object.keys(lightTuning)) {
        const control = controls.get(`light_${key}`);
        if (control && Number.isFinite(preset.lights[key])) control.set(preset.lights[key]);
      }
    }
  }

  const buttons = document.createElement('div');
  buttons.className = 'tuning__buttons';
  root.appendChild(buttons);

  const addButton = (label, onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.textContent = label;
    button.addEventListener('click', onClick);
    buttons.appendChild(button);
  };

  addButton('Speichern', () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(currentPreset())); } catch { /* quota */ }
  });
  addButton('Laden', () => applyPreset(readStored()));
  addButton('Reset', () => applyPreset(defaultPreset));

  const footer = document.createElement('div');
  footer.className = 'tuning__foot';
  footer.textContent = 'Presets liegen im localStorage.';
  root.appendChild(footer);

  function readStored() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
  }
  applyPreset(readStored());

  document.getElementById('ui').appendChild(root);

  let visible = false;
  function update() {
    if (!wasPressed('KeyT')) return;
    visible = !visible;
    root.hidden = !visible;
  }

  return {
    update,
    isVisible: () => visible,
    destroy: () => root.remove(),
  };
}
