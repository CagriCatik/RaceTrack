/**
 * Canvas minimap.
 *
 * Two changes carry the cost: the track outline is rasterised once into an offscreen
 * canvas (it never moves), and the whole thing refreshes at 20 Hz instead of on every
 * rendered frame. It also respects DPR so it is not blurry on retina displays.
 */
const UPDATE_HZ = 20;
const SIZE = 220;

export function createMinimapController(host, waypoints, playerCar, rivals = [], options = {}) {
  const cityCells = options.cityCells ?? null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // In free roam the interesting thing to map is the street grid, not the traffic loop.
  const extentSource = cityCells ? [...cityCells.values()] : waypoints;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const wp of extentSource) {
    if (wp.x < minX) minX = wp.x;
    if (wp.x > maxX) maxX = wp.x;
    if (wp.z < minZ) minZ = wp.z;
    if (wp.z > maxZ) maxZ = wp.z;
  }
  const pad = 14;
  const rangeX = Math.max(10, maxX - minX);
  const rangeZ = Math.max(10, maxZ - minZ);
  const scale = Math.min((SIZE - pad * 2) / rangeX, (SIZE - pad * 2) / rangeZ);
  const offsetX = (SIZE - rangeX * scale) * 0.5;
  const offsetY = (SIZE - rangeZ * scale) * 0.5;

  const toX = (x) => offsetX + (x - minX) * scale;
  const toY = (z) => SIZE - (offsetY + (z - minZ) * scale);

  // Pre-render the static layer once: a street grid, or the track outline.
  const trackLayer = document.createElement('canvas');
  trackLayer.width = SIZE * dpr;
  trackLayer.height = SIZE * dpr;
  const trackCtx = trackLayer.getContext('2d');
  trackCtx.scale(dpr, dpr);

  if (cityCells) {
    const cellPx = Math.max(1.5, (options.tile ?? 8) * scale);
    for (const cell of cityCells.values()) {
      if (cell.type === 'street') trackCtx.fillStyle = 'rgba(150, 200, 255, 0.5)';
      else if (cell.type === 'park') trackCtx.fillStyle = 'rgba(110, 190, 120, 0.3)';
      else if (cell.type === 'fountain') trackCtx.fillStyle = 'rgba(160, 220, 255, 0.7)';
      else continue; // buildings stay dark, so the streets read as the map
      trackCtx.fillRect(
        toX(cell.x) - cellPx * 0.5,
        toY(cell.z) - cellPx * 0.5,
        cellPx,
        cellPx
      );
    }
  } else {
    trackCtx.beginPath();
    trackCtx.moveTo(toX(waypoints[0].x), toY(waypoints[0].z));
    for (let i = 1; i < waypoints.length; i++) trackCtx.lineTo(toX(waypoints[i].x), toY(waypoints[i].z));
    trackCtx.closePath();
    trackCtx.strokeStyle = 'rgba(132, 186, 255, 0.35)';
    trackCtx.lineWidth = 9;
    trackCtx.lineJoin = 'round';
    trackCtx.stroke();
  }

  const lineLayer = document.createElement('canvas');
  lineLayer.width = SIZE * dpr;
  lineLayer.height = SIZE * dpr;
  const lineCtx = lineLayer.getContext('2d');
  lineCtx.scale(dpr, dpr);
  lineCtx.beginPath();
  lineCtx.moveTo(toX(waypoints[0].x), toY(waypoints[0].z));
  for (let i = 1; i < waypoints.length; i++) lineCtx.lineTo(toX(waypoints[i].x), toY(waypoints[i].z));
  lineCtx.closePath();
  lineCtx.strokeStyle = 'rgba(109, 212, 255, 0.9)';
  lineCtx.lineWidth = 1.5;
  lineCtx.setLineDash([4, 3]);
  lineCtx.stroke();

  let visible = true;
  let showRacingLine = true;
  let timer = 0;
  host.hidden = false;

  function drawCar(car, fill, stroke, radius) {
    const pos = car?.group?.position;
    if (!pos) return;
    const x = toX(pos.x);
    const y = toY(pos.z);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (!Number.isFinite(car.heading)) return;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      toX(pos.x + Math.sin(car.heading) * 2.4),
      toY(pos.z + Math.cos(car.heading) * 2.4)
    );
    ctx.stroke();
  }

  function update(frameDt) {
    if (!visible) return;
    timer += frameDt;
    if (timer < 1 / UPDATE_HZ) return;
    timer = 0;

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(trackLayer, 0, 0, SIZE, SIZE);
    if (showRacingLine) ctx.drawImage(lineLayer, 0, 0, SIZE, SIZE);

    for (const rival of rivals) {
      if (!rival.group.visible) continue;
      drawCar(rival, 'rgba(255, 176, 73, 0.95)', 'rgba(255, 220, 164, 0.9)', 3.4);
    }
    drawCar(playerCar, 'rgba(255, 96, 96, 1)', 'rgba(255, 190, 190, 0.95)', 4.6);
  }

  return {
    update,
    toggle() {
      visible = !visible;
      host.hidden = !visible;
      return visible;
    },
    toggleRacingLine() {
      showRacingLine = !showRacingLine;
      return showRacingLine;
    },
    isVisible: () => visible,
    isRacingLineVisible: () => showRacingLine,
  };
}
