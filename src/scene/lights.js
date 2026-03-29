import * as THREE from 'three';

export function addStreetLights(scene, curve, roadWidth) {
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x5b6068, roughness: 0.55, metalness: 0.35 });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xf6eed8,
    emissive: 0xf6eed8,
    emissiveIntensity: 2.8,
    roughness: 0.15,
  });
  const pointLights = [];
  const bulbs = [];

  for (let i = 0; i < 16; i++) {
    const u = i / 16;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const n = new THREE.Vector3(-t.z, 0, t.x).normalize();
    const side = (i % 2 === 0) ? 1 : -1;
    const base = p.clone().addScaledVector(n, side * (roadWidth * 0.9));

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.4, 10), poleMat);
    pole.position.set(base.x, 1.7, base.z);
    pole.castShadow = false;
    pole.receiveShadow = true;
    scene.add(pole);

    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), bulbMat);
    bulb.position.set(base.x, 3.45, base.z);
    bulb.userData.onEmissiveIntensity = bulb.material.emissiveIntensity;
    scene.add(bulb);
    bulbs.push(bulb);

    const light = new THREE.PointLight(0xffefcf, 1.35, 15, 2);
    light.position.set(base.x, 3.45, base.z);
    light.userData.onIntensity = light.intensity;
    scene.add(light);
    pointLights.push(light);
  }

  let enabled = true;
  function setEnabled(nextEnabled) {
    enabled = !!nextEnabled;
    const bulbScale = enabled ? 1 : 0.08;
    pointLights.forEach((light) => {
      light.intensity = enabled ? (light.userData.onIntensity ?? 1.35) : 0;
    });
    bulbs.forEach((bulb) => {
      bulb.material.emissiveIntensity = (bulb.userData.onEmissiveIntensity ?? 2.8) * bulbScale;
    });
  }

  return {
    setEnabled,
    isEnabled: () => enabled,
    pointLights,
  };
}
