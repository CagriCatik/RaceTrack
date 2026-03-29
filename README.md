<div align="center">

# 🚗 RaceTrack - A Three.js Car Game

[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Three.js](https://img.shields.io/badge/Three.js-000000?style=flat&logo=three.js&logoColor=white)](https://threejs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat)](LICENSE)

*A lightweight 3D car racing game built with Three.js*

[Features](#features) • [Quick Start](#quick-start) • [Controls](#controls) • [Customization](#customization)

</div>

<p align="center">
  <img src="assets/image.png" alt="RaceTrack Game" />
</p>

## Features

- 🎮 **Immersive 3D gameplay** – Race through a dynamic 3D environment
- 🏎️ **Vehicle physics** – Realistic car handling and acceleration
- 🎯 **AI rivals** – Compete against computer-controlled opponents
- ⚙️ **Easy customization** – Swap vehicle models or adjust game parameters
- 🚀 **Lightweight** – Minimal dependencies, pure Three.js rendering

## Quick Start

### Prerequisites
- A modern web browser (Chrome, Firefox, Edge, Safari)
- Python 3+ or Node.js with `npx`

### Installation

1. **Start a local web server:**
   ```shell
   # Using Python
   python -m http.server 8000
   
   # Or using npx
   npx serve
   ```

2. **Open your browser** and navigate to `http://localhost:8000`

3. **Start racing!** The game launches automatically. Use the controls below to drive.

## Controls

### Movement
| Key | Action |
|-----|--------|
| **W** / **↑** | Accelerate forward |
| **S** / **↓** | Accelerate backward (reverse) |
| **A** / **←** | Steer left |
| **D** / **→** | Steer right |

### Camera
- **Right-click + drag** – Rotate camera view
- **Shift + right-click drag** – Zoom in/out
- **Right-click + middle-click** – Pan camera

## Customization

### Replace Vehicle Model
In `src/Vehicle.js`, replace the default box geometry with your own GLTF/OBJ model:
```javascript
// Load a custom model instead of creating a box
const loader = new GLTFLoader();
loader.load('path/to/model.glb', (gltf) => {
  vehicle.add(gltf.scene);
});
```

### Adjust Vehicle Physics
Modify vehicle parameters in `src/config/vehicleConfig.js`:
- `acceleration` – How quickly the car speeds up
- `maxSpeed` – Maximum velocity
- `turnSpeed` – Steering sensitivity

## Project Structure

```
src/
├── main.js                 # Entry point
├── Vehicle.js              # Vehicle class and physics
├── scene.js                # Scene setup and management
├── config/                 # Configuration files
└── core/                   # Core systems
    ├── gameLoop.js         # Main game loop
    ├── cameraController.js # Camera management
    ├── collisionSystem.js   # Collision detection
    └── aiRivalsController.js # AI opponent logic
```

## Technologies

- **[Three.js](https://threejs.org/)** – 3D rendering engine
- **[Kenney Assets](https://kenney.nl/)** – 3D car models and textures
- **Vanilla JavaScript** – No frameworks, pure ES6+

---

**Enjoy the race! 🏁**
