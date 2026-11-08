#!/usr/bin/env node
/**
 * Fails the build if the catalog references a model or preview that is not on disk.
 *
 * Asset paths in this project contain a space ("GLB format"), which survives a local
 * `python -m http.server` but is an easy thing to break when staging files for a
 * deploy — so it is checked rather than trusted.
 *
 * Usage: node scripts/check-assets.mjs [rootDir]
 */
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] || join(here, '..'));

const { PLAYABLE_CARS, RIVAL_CARS, PROP_KINDS, modelPath, previewPath } =
  await import(new URL(`file://${join(root, 'src/config/carCatalog.js')}`).href);
const { CITY_MODEL_IDS, cityModelPath } =
  await import(new URL(`file://${join(root, 'src/config/cityCatalog.js')}`).href);

const missing = [];
const check = (relative, label) => {
  const full = join(root, relative);
  if (!existsSync(full)) missing.push(`${label}: ${relative}`);
};

for (const car of PLAYABLE_CARS) {
  check(modelPath(car.id), `playable model "${car.name}"`);
  check(previewPath(car.id), `playable preview "${car.name}"`);
}
for (const rival of RIVAL_CARS) check(modelPath(rival.id), `rival model "${rival.name}"`);
for (const prop of Object.values(PROP_KINDS)) check(modelPath(prop.id), `prop model "${prop.id}"`);
for (const id of CITY_MODEL_IDS) check(cityModelPath(id), `city model "${id}"`);
// The city GLBs reference this texture with a *relative* URI, so it has to sit
// exactly here or every building loads untextured.
check('assets/kenney_city-kit/Models/Textures/colormap.png', 'city texture');
check('assets/kenney_car-kit/Models/GLB format/Textures/colormap.png', 'car-kit texture');
for (const file of ['index.html', 'style.css', 'src/main.js']) check(file, 'entry file');

if (missing.length) {
  console.error(`✗ ${missing.length} missing asset(s) under ${root}:`);
  for (const line of missing) console.error(`  - ${line}`);
  process.exit(1);
}

const total = PLAYABLE_CARS.length + RIVAL_CARS.length + Object.keys(PROP_KINDS).length + CITY_MODEL_IDS.length;
console.log(`✓ all ${total} referenced models, ${PLAYABLE_CARS.length} previews and 2 textures present under ${root}`);
