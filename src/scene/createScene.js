import * as THREE from 'three';
import Vehicle from '../Vehicle.js?v=unified-20260329-22';
import { addGroundAndTerrain, addBackgroundTrees } from './environment.js?v=unified-20260329-22';
import { addStreetLights } from './lights.js?v=unified-20260329-22';
import { addTrackObstacles } from './obstacles.js?v=unified-20260329-22';
import { addGuardrails, addTrackMesh, createTrackCurve } from './track.js?v=unified-20260329-22';
import { addWeatherEffects } from './weather.js?v=unified-20260329-22';

function createBaseScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1322);
  scene.fog = new THREE.Fog(0x101829, 22, 130);

  const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(-18, 11, -26);
  camera.lookAt(0, 1, 8);

  const hemi = new THREE.HemisphereLight(0x4f678a, 0x12160f, 0.32);
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(0xaec3ff, 0.58);
  moon.position.set(22, 26, 16);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 120;
  moon.shadow.camera.left = -55;
  moon.shadow.camera.right = 55;
  moon.shadow.camera.top = 55;
  moon.shadow.camera.bottom = -55;
  scene.add(moon);

  const ambient = new THREE.AmbientLight(0x1a2234, 0.38);
  scene.add(ambient);

  const atmosphere = {
    dark: {
      background: 0x0d1322,
      fogColor: 0x101829,
      fogNear: 22,
      fogFar: 130,
      hemiSky: 0x4f678a,
      hemiGround: 0x12160f,
      hemiIntensity: 0.32,
      moonColor: 0xaec3ff,
      moonIntensity: 0.58,
      ambientColor: 0x1a2234,
      ambientIntensity: 0.38,
    },
    light: {
      background: 0xc4d9ef,
      fogColor: 0xc6d7ea,
      fogNear: 44,
      fogFar: 260,
      hemiSky: 0xc8dbf5,
      hemiGround: 0x71865c,
      hemiIntensity: 0.86,
      moonColor: 0xfff5d8,
      moonIntensity: 0.84,
      ambientColor: 0xb8c8dc,
      ambientIntensity: 0.72,
    },
  };

  let darkMode = true;
  function setDarkMode(nextDarkMode) {
    darkMode = !!nextDarkMode;
    const profile = darkMode ? atmosphere.dark : atmosphere.light;
    scene.background = new THREE.Color(profile.background);
    if (scene.fog) {
      scene.fog.color.setHex(profile.fogColor);
      scene.fog.near = profile.fogNear;
      scene.fog.far = profile.fogFar;
    }
    hemi.color.setHex(profile.hemiSky);
    hemi.groundColor.setHex(profile.hemiGround);
    hemi.intensity = profile.hemiIntensity;
    moon.color.setHex(profile.moonColor);
    moon.intensity = profile.moonIntensity;
    ambient.color.setHex(profile.ambientColor);
    ambient.intensity = profile.ambientIntensity;
  }

  setDarkMode(true);

  return { scene, camera, setDarkMode, isDarkMode: () => darkMode };
}

function addVehicle(scene, curve) {
  const car = new Vehicle();
  const spawnU = 0.04; // clean straight spawn close to start/finish
  const spawn = curve.getPointAt(spawnU);
  const tangent = curve.getTangentAt(spawnU);
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  const laneOffset = 0;
  const startYaw = Math.atan2(tangent.x, tangent.z);
  car.group.position.set(
    spawn.x + normal.x * laneOffset,
    0,
    spawn.z + normal.z * laneOffset
  );
  car.group.rotation.y = startYaw;
  car.heading = startYaw; // keep physics heading in sync with spawn orientation
  car.speed = 0;
  car.steerInput = 0;
  car.steerAngle = 0;
  scene.add(car.group);
  return car;
}

function addWaypoints(scene, curve, roadWidth) {
  const waypointCount = 96;
  const waypoints = [];
  const debugObjects = [];

  const markerMat = new THREE.MeshStandardMaterial({
    color: 0x6dd4ff,
    emissive: 0x2a7ab0,
    emissiveIntensity: 2.0,
    roughness: 0.3,
  });
  const markerGeom = new THREE.SphereGeometry(0.085, 10, 10);

  for (let i = 0; i < waypointCount; i++) {
    const u = i / waypointCount;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const n = new THREE.Vector3(-t.z, 0, t.x).normalize();
    const offset = Math.sin(u * Math.PI * 2) * roadWidth * 0.08;
    const wp = p.clone().addScaledVector(n, offset);
    wp.y = 0;
    waypoints.push(wp);

    if (i % 2 === 0) {
      const marker = new THREE.Mesh(markerGeom, markerMat);
      marker.position.set(wp.x, 0.12, wp.z);
      marker.castShadow = false;
      marker.receiveShadow = true;
      marker.visible = false;
      scene.add(marker);
      debugObjects.push(marker);
    }
  }

  const linePoints = waypoints.map((wp) => new THREE.Vector3(wp.x, 0.07, wp.z));
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(linePoints),
    new THREE.LineBasicMaterial({ color: 0x6dd4ff, transparent: true, opacity: 0.8 })
  );
  line.visible = false;
  scene.add(line);
  debugObjects.push(line);

  return { waypoints, debugObjects };
}

export async function createScene() {
  const {
    scene,
    camera,
    setDarkMode: setAtmosphereDarkMode,
    isDarkMode: isAtmosphereDarkMode,
  } = createBaseScene();

  addGroundAndTerrain(scene);

  const curve = createTrackCurve();
  const { roadWidth, finishLine } = addTrackMesh(scene, curve);
  addGuardrails(scene, curve, roadWidth);
  const streetLights = addStreetLights(scene, curve, roadWidth);
  addBackgroundTrees(scene);
  const { waypoints, debugObjects: waypointDebugObjects } = addWaypoints(scene, curve, roadWidth);

  const car = addVehicle(scene, curve);
  const obstacles = await addTrackObstacles(scene, curve, roadWidth);
  const weather = addWeatherEffects(scene, {
    baseZ: 10,
    darkColor: 0xaec3de,
    darkOpacity: 0.2,
    lightColor: 0xffffff,
    lightOpacity: 0.05,
  });
  let darkEnvironment = isAtmosphereDarkMode();
  function setDarkEnvironment(nextDarkEnvironment) {
    darkEnvironment = !!nextDarkEnvironment;
    setAtmosphereDarkMode(darkEnvironment);
    weather.setDarkMode(darkEnvironment);
  }

  setDarkEnvironment(darkEnvironment);

  return {
    scene,
    camera,
    car,
    obstacles,
    roadWidth,
    waypoints,
    waypointDebugObjects,
    finishLine,
    streetLightsController: streetLights,
    setDarkEnvironment,
    isDarkEnvironment: () => darkEnvironment,
    updateSceneEffects: weather.update,
  };
}






