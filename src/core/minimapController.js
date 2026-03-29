export function createMinimapController(waypoints = [], playerCar, rivals = []) {
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 240;
  canvas.style.position = 'fixed';
  canvas.style.right = '14px';
  canvas.style.bottom = '14px';
  canvas.style.width = '240px';
  canvas.style.height = '240px';
  canvas.style.border = '1px solid rgba(184, 220, 255, 0.45)';
  canvas.style.borderRadius = '8px';
  canvas.style.background = 'rgba(0, 0, 0, 0.46)';
  canvas.style.zIndex = '11';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let visible = true;
  let showRacingLine = true;
  let mapHeld = false;
  let lineHeld = false;

  const sourcePoints = waypoints.length
    ? waypoints
    : [{ x: playerCar?.group?.position?.x ?? 0, z: playerCar?.group?.position?.z ?? 0 }];
  const minX = Math.min(...sourcePoints.map((p) => p.x));
  const maxX = Math.max(...sourcePoints.map((p) => p.x));
  const minZ = Math.min(...sourcePoints.map((p) => p.z));
  const maxZ = Math.max(...sourcePoints.map((p) => p.z));
  const pad = 5;
  const rangeX = Math.max(10, maxX - minX);
  const rangeZ = Math.max(10, maxZ - minZ);
  const scale = Math.min((canvas.width - pad * 2) / rangeX, (canvas.height - pad * 2) / rangeZ);
  const offsetX = (canvas.width - rangeX * scale) * 0.5;
  const offsetY = (canvas.height - rangeZ * scale) * 0.5;

  function toMap(x, z) {
    return {
      x: offsetX + (x - minX) * scale,
      y: canvas.height - (offsetY + (z - minZ) * scale),
    };
  }

  function drawTrack() {
    if (!showRacingLine || waypoints.length < 2) return;
    ctx.beginPath();
    const start = toMap(waypoints[0].x, waypoints[0].z);
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < waypoints.length; i++) {
      const p = toMap(waypoints[i].x, waypoints[i].z);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(120, 215, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawCar(car, color, radius = 4) {
    if (!car?.group?.position) return;
    const p = toMap(car.group.position.x, car.group.position.z);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHeading(car, color) {
    if (!car?.group?.position || !Number.isFinite(car?.heading)) return;
    const base = toMap(car.group.position.x, car.group.position.z);
    const hx = Math.sin(car.heading);
    const hz = Math.cos(car.heading);
    const tip = toMap(car.group.position.x + hx * 1.6, car.group.position.z + hz * 1.6);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
  }

  function update(keys) {
    const mapToggle = keys?.has?.('KeyM') ?? false;
    if (mapToggle && !mapHeld) {
      visible = !visible;
      canvas.style.display = visible ? 'block' : 'none';
    }
    mapHeld = mapToggle;

    const lineToggle = keys?.has?.('KeyR') ?? false;
    if (lineToggle && !lineHeld) {
      showRacingLine = !showRacingLine;
    }
    lineHeld = lineToggle;

    if (!visible || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(7, 15, 24, 0.84)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawTrack();

    for (const rival of rivals) {
      drawCar(rival, 'rgba(255, 176, 73, 0.92)', 3.5);
      drawHeading(rival, 'rgba(255, 220, 164, 0.92)');
    }

    drawCar(playerCar, 'rgba(255, 96, 96, 0.98)', 4.8);
    drawHeading(playerCar, 'rgba(255, 190, 190, 0.95)');
  }

  return {
    update,
    isVisible: () => visible,
    isRacingLineVisible: () => showRacingLine,
  };
}
