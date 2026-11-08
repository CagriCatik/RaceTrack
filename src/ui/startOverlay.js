import { PLAYABLE_CARS, DEFAULT_CAR_ID, modelPath, previewPath } from '../config/carCatalog.js';
import { CITY_MODEL_IDS, cityModelPath } from '../config/cityCatalog.js';
import { preloadModels } from '../core/assetLoader.js';

const STORAGE_KEY = 'racetrack.car.v1';
const SCENARIO_KEY = 'racetrack.scenario.v1';

/**
 * Car picker + loading screen, built from the kit's own `Previews/*.png`.
 *
 * It also doubles as the audio gesture: browsers refuse to start an AudioContext
 * without a user interaction, so "Rennen starten" is the natural unlock point.
 */
export function createStartOverlay(root) {
  const grid = root.querySelector('#car-grid');
  const specs = root.querySelector('#car-specs');
  const status = root.querySelector('#start-status');
  const button = root.querySelector('#start-button');

  const scenarioButtons = [...root.querySelectorAll('.scenario__option')];
  const cards = new Map();
  let selectedId = loadSelection();
  let scenario = loadScenario();

  function loadSelection() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && PLAYABLE_CARS.some((c) => c.id === stored)) return stored;
    } catch { /* private mode */ }
    return DEFAULT_CAR_ID;
  }

  function loadScenario() {
    try {
      const stored = localStorage.getItem(SCENARIO_KEY);
      if (stored === 'city' || stored === 'country' || stored === 'freeroam') return stored;
    } catch { /* private mode */ }
    return 'city';
  }

  function selectScenario(next) {
    scenario = next;
    for (const button of scenarioButtons) {
      button.setAttribute('aria-checked', String(button.dataset.scenario === next));
    }
    try { localStorage.setItem(SCENARIO_KEY, next); } catch { /* ignore */ }
  }

  for (const button of scenarioButtons) {
    button.addEventListener('click', () => selectScenario(button.dataset.scenario));
  }

  for (const entry of PLAYABLE_CARS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'car-card';
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(entry.id === selectedId));
    card.dataset.carId = entry.id;

    const img = document.createElement('img');
    img.src = previewPath(entry.id);
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 128;
    img.height = 128;

    const name = document.createElement('span');
    name.textContent = entry.name;
    const klass = document.createElement('small');
    klass.textContent = entry.klass;

    card.append(img, name, klass);
    card.addEventListener('click', () => select(entry.id));
    grid.appendChild(card);
    cards.set(entry.id, card);
  }

  function select(id) {
    selectedId = id;
    for (const [carId, card] of cards) card.setAttribute('aria-checked', String(carId === id));

    const entry = PLAYABLE_CARS.find((c) => c.id === id);
    specs.textContent = '';
    const stats = [
      ['Top', `${Math.round((entry.dynamics?.maxSpeed ?? 18) * 3.6)} km/h`],
      ['Beschl.', `${(entry.dynamics?.accelRate ?? 11).toFixed(1)} m/s²`],
      ['Grip', `${(entry.dynamics?.gripLimit ?? 12).toFixed(1)}`],
      ['Klasse', entry.klass],
    ];
    for (const [label, value] of stats) {
      const cell = document.createElement('div');
      cell.append(document.createTextNode(label));
      const strong = document.createElement('b');
      strong.textContent = value;
      cell.appendChild(strong);
      specs.appendChild(cell);
    }
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
  }

  select(selectedId);
  selectScenario(scenario);

  /** Resolves with the chosen car + scenario once the player presses start. */
  function waitForStart(extraModelIds = []) {
    return new Promise((resolve) => {
      const begin = async () => {
        if (button.disabled) return;
        button.disabled = true;
        const paths = [selectedId, ...extraModelIds].map(modelPath);
        if (scenario !== 'country') paths.push(...CITY_MODEL_IDS.map(cityModelPath));
        status.textContent = 'Modelle laden…';
        await preloadModels(paths, (progress, done, total) => {
          status.textContent = `Modelle laden… ${done}/${total}`;
          button.textContent = `Lade ${Math.round(progress * 100)}%`;
        });
        status.textContent = scenario === 'country' ? 'Strecke aufbauen…' : 'Stadt aufbauen…';
        button.textContent = 'Startet…';
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
