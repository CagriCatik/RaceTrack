import { PLAYABLE_CARS, DEFAULT_CAR_ID, modelPath, previewPath } from '../config/carCatalog.js';
import { CITY_MODEL_IDS, cityModelPath } from '../config/cityCatalog.js';
import { preloadModels } from '../core/assetLoader.js';

const CAR_KEY = 'racetrack.car.v1';
const SCENARIO_KEY = 'racetrack.scenario.v1';
const SCENARIOS = ['city', 'country', 'freeroam'];

/** Upper bounds used to normalise the stat bars; a little above the fastest car. */
const STAT_RANGE = {
  maxSpeed: 30,
  accelRate: 19,
  gripLimit: 18,
};

/**
 * Start screen: mode picker, vehicle picker and a showcase of the current selection,
 * built from the kit's own `Previews/*.png`.
 *
 * It doubles as the loading screen and as the audio gesture — browsers refuse to start
 * an AudioContext without a user interaction, so "Start" is the natural unlock point.
 */
export function createStartOverlay(root) {
  const grid = root.querySelector('#car-grid');
  const status = root.querySelector('#start-status');
  const button = root.querySelector('#start-button');
  const countLabel = root.querySelector('#car-count');
  const showcase = {
    image: root.querySelector('#showcase-image'),
    name: root.querySelector('#showcase-name'),
    klass: root.querySelector('#showcase-class'),
    stats: root.querySelector('#showcase-stats'),
  };
  const modeButtons = [...root.querySelectorAll('.mode')];

  const cards = new Map();
  let selectedId = readStored(CAR_KEY, (v) => PLAYABLE_CARS.some((c) => c.id === v), DEFAULT_CAR_ID);
  let scenario = readStored(SCENARIO_KEY, (v) => SCENARIOS.includes(v), 'city');

  function readStored(key, isValid, fallback) {
    try {
      const value = localStorage.getItem(key);
      if (value && isValid(value)) return value;
    } catch { /* private mode */ }
    return fallback;
  }

  function store(key, value) {
    try { localStorage.setItem(key, value); } catch { /* quota */ }
  }

  // ── Stat bars, rebuilt once and then only updated
  const bars = new Map();
  for (const [key, label] of [['maxSpeed', 'Speed'], ['accelRate', 'Accel'], ['gripLimit', 'Grip']]) {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const track = document.createElement('div');
    track.className = 'bar';
    const fill = document.createElement('i');
    track.appendChild(fill);
    const dd = document.createElement('dd');
    row.append(dt, track, dd);
    showcase.stats.appendChild(row);
    bars.set(key, { fill, value: dd });
  }

  // ── Vehicle cards
  for (const entry of PLAYABLE_CARS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'car-card';
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(entry.id === selectedId));
    card.title = `${entry.name} — ${entry.klass}`;

    const img = document.createElement('img');
    img.src = previewPath(entry.id);
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 96;
    img.height = 96;

    const name = document.createElement('span');
    name.textContent = entry.name;

    card.append(img, name);
    card.addEventListener('click', () => selectCar(entry.id));
    grid.appendChild(card);
    cards.set(entry.id, card);
  }
  if (countLabel) countLabel.textContent = `(${PLAYABLE_CARS.length})`;

  function selectCar(id) {
    selectedId = id;
    for (const [carId, card] of cards) card.setAttribute('aria-checked', String(carId === id));

    const entry = PLAYABLE_CARS.find((c) => c.id === id);
    showcase.image.src = previewPath(id);
    showcase.image.alt = entry.name;
    showcase.name.textContent = entry.name;
    showcase.klass.textContent = entry.klass;

    const dynamics = entry.dynamics ?? {};
    const shown = {
      maxSpeed: `${Math.round((dynamics.maxSpeed ?? 18) * 3.6)} km/h`,
      accelRate: `${(dynamics.accelRate ?? 11).toFixed(1)} m/s²`,
      gripLimit: (dynamics.gripLimit ?? 12).toFixed(1),
    };
    for (const [key, bar] of bars) {
      const raw = dynamics[key] ?? 0;
      bar.fill.style.width = `${Math.min(100, (raw / STAT_RANGE[key]) * 100).toFixed(0)}%`;
      bar.value.textContent = shown[key];
    }
    store(CAR_KEY, id);
  }

  function selectScenario(next) {
    scenario = next;
    for (const mode of modeButtons) {
      mode.setAttribute('aria-checked', String(mode.dataset.scenario === next));
    }
    store(SCENARIO_KEY, next);
  }

  for (const mode of modeButtons) {
    mode.addEventListener('click', () => selectScenario(mode.dataset.scenario));
  }

  selectCar(selectedId);
  selectScenario(scenario);

  /** Resolves with the chosen car + mode once the player presses start. */
  function waitForStart(extraModelIds = []) {
    return new Promise((resolve) => {
      const begin = async () => {
        if (button.disabled) return;
        button.disabled = true;

        const paths = [selectedId, ...extraModelIds].map(modelPath);
        if (scenario !== 'country') paths.push(...CITY_MODEL_IDS.map(cityModelPath));

        status.textContent = 'Loading models…';
        await preloadModels(paths, (progress, done, total) => {
          status.textContent = `Loading models… ${done}/${total}`;
          button.textContent = `${Math.round(progress * 100)}%`;
        });

        status.textContent = scenario === 'country' ? 'Building the track…' : 'Building the city…';
        button.textContent = 'Starting…';
        resolve({ carId: selectedId, scenario });
      };

      button.addEventListener('click', begin, { once: true });
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !root.hidden) begin();
      });
    });
  }

  return {
    waitForStart,
    setStatus: (text) => { status.textContent = text; },
    close() {
      root.classList.add('is-closing');
      setTimeout(() => { root.hidden = true; }, 340);
    },
    selected: () => selectedId,
    scenario: () => scenario,
  };
}
