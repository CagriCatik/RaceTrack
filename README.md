<div align="center">

# 🏁 RaceTrack

**A Three.js racing sandbox with no build step — open the HTML, start driving.**

[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?style=flat&logo=three.js&logoColor=white)](https://threejs.org/)
[![No build](https://img.shields.io/badge/build-none-brightgreen?style=flat)](#quick-start)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat)](LICENSE)

<img src="assets/image.png" alt="RaceTrack" width="760" />

</div>

## Features

- **Three game modes:** *City Circuit* (a street race through a procedurally built town), *Country Track* (open circuit with woods and rolling hills) and ***Free Roam*** — the whole city with no track at all, building collision and a trip computer
- **14 playable cars** from the Kenney Car Kit, picked on a start screen built from the kit's own preview renders
- **Vehicle physics** with Ackermann steering, slip-angle drift, a grip limit, load transfer and suspension
- **3 AI opponents** with their own models, lanes and rear-end detection
- **Lap timing** including sector checkpoints, track-limit detection, a stored best-time table and a **ghost** of your fastest lap
- **Obstacles** (cones, crates, debris) that fly off and cost you momentum when you clip them
- **Guardrail collision**, day/night toggle, minimap, live tuning panel, procedural engine audio
- **No dependencies, no bundler** — Three.js comes from a CDN via an import map

## Quick start

```shell
# Any static file server, for example
python3 -m http.server 8000
# or
npx serve -l 8000
```

Then open **http://localhost:8000**. Opening the file directly with `file://` will not
work — ES modules and `fetch()` on the GLB files both need HTTP.

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` / arrow keys | Throttle, steer, brake / reverse |
| `Space` | Handbrake (kicks the rear out) |
| `C` | Camera: chase → hood → orbit |
| `P` | Autopilot |
| `O` | AI opponents on/off |
| `G` | Best-lap ghost |
| `M` / `R` | Minimap / racing line |
| `L` / `N` | Headlights / day–night |
| `T` / `V` | Tuning panel / waypoint debug |
| `F` / `H` | Performance stats / help |
| `Backspace` | Put the car back on the road |

## Free Roam

No circuit, no timing: the city fills a 224 × 224 metre grid, you start at an
intersection and drive wherever you like. The HUD turns into a trip computer —
distance, elapsed time and top speed instead of laps.

Three things make this mode different from the circuits:

- **Buildings stop you.** Without a track there is no guardrail corridor keeping the
  car honest. `createCityCollider` in [`src/scene/city.js`](src/scene/city.js) buckets
  the building footprints onto the same grid the city is built from, only ever tests
  the nine cells around the car, and pushes it out along the *shallower* of the two
  overlap axes — that is, through the wall you actually hit.
- **The shadow box travels.** The shadow map covers about 90 m; the city is 224 m
  across. Rather than inflate the map (and throw away its resolution), the sun and its
  shadow frustum follow the car.
- **The opponents become traffic.** They drive a closed loop through the street grid
  that is generated as an ordinary `trackPath`, so the pure-pursuit driver, the minimap
  and the rear-end detection all keep working unchanged.

The minimap shows the street layout instead of a racing line, and `Backspace` drops you
back onto the nearest street if you wedge yourself somewhere.

## The city

The city is generated at startup from 1×1 tiles of the Kenney city-builder kit, not
placed by hand. For every cell of the 8-metre grid,
[`src/scene/city.js`](src/scene/city.js) asks the track centre line how far away it is
and decides from that:

| Distance from the centre line | Result |
| --- | --- |
| < 10.5 m | empty (racing surface + guardrail) |
| < 15 m | pavement |
| inside the oval | park, with a fountain at its centre |
| otherwise | city block: street, building or green space |

The street network auto-tiles: every street cell reads its four neighbours as a bitmask
and picks straight, corner, T-junction or crossroads with the matching rotation, so the
grid closes off cleanly where it meets the circuit. Placement is driven by a hash, so
the city looks identical on every reload.

The same generator builds Free Roam; it just skips the track query.

Two numbers that are not obvious: the clearances use the tile's **half-diagonal**
(5.66 m for an 8 m tile), not its half-width, or building corners poke onto the racing
line. And the kit's tiles are base plates — a road sits 0.05 units high and a pavement
0.06, which is 40 and 48 cm at an 8 m tile. The whole city is therefore lowered by the
road height (`CITY_Y`) so road surfaces land at `y = 0` and are drivable; the pavements
then stand 8 cm proud, which reads as a kerb.

The entire city costs **14 extra draw calls** — one InstancedMesh per model type.

## Deploying to GitHub Pages

The game is fully static and runs on Pages unchanged.

1. Repository → **Settings → Pages → Source: GitHub Actions**
2. Push to `main` — [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)
   does the rest.

The workflow deliberately stages only the runtime files (GLB models, previews, `src/`,
HTML/CSS). The Car Kit's FBX and OBJ variants and `assets/car.glb` stay in the
repository but are not published: **~7 MB instead of ~29 MB**.

Two things that otherwise trip Pages up:

- `.nojekyll` sits in the repository root, or Jekyll filters paths out.
- The asset path contains a space (`Models/GLB format/`). That works URL-encoded but is
  easy to break when restructuring, so `npm run check` (and the workflow step) verifies
  that every model referenced by the catalogs is actually shipped.

## Project layout

```
src/
├── main.js                     Bootstrap + game loop
├── input.js                    Keyboard with edge detection and focus reset
├── Vehicle.js                  Physics, model wheels, lamps, exhaust
├── config/
│   ├── vehicleConfig.js        Base values + merge logic
│   ├── carCatalog.js           Cars, opponents and track props
│   └── cityCatalog.js          City models and grid parameters
├── core/
│   ├── assetLoader.js          GLB cache, shared material/texture per kit
│   ├── instancing.js           InstancedMesh helpers
│   ├── trackPath.js            Allocation-free track geometry queries
│   ├── pathDriver.js           Pure-pursuit driver (autopilot + AI)
│   ├── collisionSystem.js      Props, guardrail corridor, buildings
│   ├── lapController.js        Lap times, checkpoints, ghost sampling
│   └── …                       Camera, loop, renderer, audio, tuning, minimap
├── scene/
│   ├── createScene.js          Assembles the world per game mode
│   ├── city.js                 City grid, street auto-tiling, building collision
│   ├── track.js                Road surface, kerbs, guardrails (all instanced)
│   ├── materials.js            Shared materials
│   └── …                       Terrain, lighting, props, weather
└── ui/
    ├── hud.js                  HUD, toasts, performance overlay
    └── startOverlay.js         Vehicle picker + loading screen
```

## Customising

**Add a car** — add an entry to [`src/config/carCatalog.js`](src/config/carCatalog.js).
The `id` is the file name in the kit (without `.glb`); the preview image is picked up
from `Previews/<id>.png` automatically:

```js
{ id: 'garbage-truck', name: 'Garbage Truck', klass: 'Utility', bodyLength: 5.4,
  dynamics: { maxSpeed: 12, accelRate: 6.5, gripLimit: 8 } }
```

**Handling** — tweak it live with `T` and save a preset, or change the starting values
in [`src/config/vehicleConfig.js`](src/config/vehicleConfig.js).

**Track** — the dimensions live in `TRACK` in [`src/scene/track.js`](src/scene/track.js).

**City** — block size, street spacing, green ratio and extent live in `CITY_LAYOUT`
(City Circuit) and `FREEROAM_LAYOUT` (Free Roam) in
[`src/config/cityCatalog.js`](src/config/cityCatalog.js).

## Coordinate system

Forward is `+Z`, up is `+Y`, which puts the car's **left** side on `+X`
(`right = forward × up`). A positive steering angle means a left turn, and increasing
`heading` rotates to the left. The Kenney models follow the same convention
(`wheel-front-left` sits at `+X`), which is why their wheels can be adopted directly.

## Built with

- [Three.js r165](https://threejs.org/) via a CDN import map (`three`, `three/addons/`)
- Vanilla ES modules, no bundler, no `node_modules`

### Assets

| Pack | Used for | Source | Licence |
| --- | --- | --- | --- |
| Kenney **Car Kit** | Vehicles, cones, debris | [kenney.nl](https://kenney.nl/assets/car-kit) | CC0 |
| Kenney **Starter Kit: City Builder** | Buildings, roads, pavements, parks | [github.com/KenneyNL](https://github.com/KenneyNL/Starter-Kit-City-Builder) | CC0 (repo code MIT) |

Details in `assets/kenney_car-kit/License.txt` and `assets/kenney_city-kit/CREDITS.txt`.

Both kits texture their models with a file called `colormap.png` — but they are **two
different palettes**. [`src/core/assetLoader.js`](src/core/assetLoader.js) therefore
shares material and texture *per kit* (keyed by directory) rather than globally.

---

<div align="center"><b>Have a good run 🏎️</b></div>
