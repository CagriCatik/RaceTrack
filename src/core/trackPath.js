/**
 * Allocation-free queries against the closed centre line.
 *
 * The old code had three near-identical copies of this logic (autopilot, AI rivals,
 * lap timing), each doing a full O(n) scan with ~5 `new Vector3()` per segment, every
 * physics step, for every car. At 60 Hz with two rivals that was ~170k throwaway
 * vectors a second. Everything here works on flat Float64Arrays and writes into a
 * caller-owned result object instead.
 */
export function createTrackPath(waypoints) {
  const n = waypoints.length;
  if (n < 3) throw new Error('createTrackPath needs at least 3 waypoints.');

  const xs = new Float64Array(n);
  const zs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = waypoints[i].x;
    zs[i] = waypoints[i].z;
  }

  // cum[i] = arc length from waypoint 0 to waypoint i, cum[n] = full lap length
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    cum[i + 1] = cum[i] + Math.hypot(xs[j] - xs[i], zs[j] - zs[i]);
  }
  const totalLength = cum[n];

  function wrap(s) {
    const v = s % totalLength;
    return v < 0 ? v + totalLength : v;
  }

  /** Projects (px,pz) onto segment i; returns squared distance and writes the hit. */
  function projectSegment(i, px, pz, out) {
    const j = (i + 1) % n;
    const ax = xs[i];
    const az = zs[i];
    const abx = xs[j] - ax;
    const abz = zs[j] - az;
    const lenSq = abx * abx + abz * abz || 1e-9;
    let t = ((px - ax) * abx + (pz - az) * abz) / lenSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const hx = ax + abx * t;
    const hz = az + abz * t;
    const dx = px - hx;
    const dz = pz - hz;
    const distSq = dx * dx + dz * dz;
    if (out) {
      out.segment = i;
      out.t = t;
      out.x = hx;
      out.z = hz;
      out.s = cum[i] + Math.sqrt(lenSq) * t;
      out.distSq = distSq;
      out.distance = Math.sqrt(distSq);
      // Signed side: >0 means left of travel direction.
      const invLen = 1 / Math.sqrt(lenSq);
      out.tangentX = abx * invLen;
      out.tangentZ = abz * invLen;
      out.side = dx * out.tangentZ - dz * out.tangentX;
    }
    return distSq;
  }

  const probe = createResult();

  /**
   * Nearest point on the path. `hint` is the previous segment index; the search starts
   * there and only falls back to a full scan when the local window misses, which makes
   * the common case O(window) instead of O(n).
   */
  function nearest(px, pz, hint = -1, out = probe, window = 6) {
    let bestSq = Infinity;
    let bestSegment = -1;

    if (hint >= 0) {
      for (let k = -window; k <= window; k++) {
        const i = (((hint + k) % n) + n) % n;
        const d = projectSegment(i, px, pz, null);
        if (d < bestSq) {
          bestSq = d;
          bestSegment = i;
        }
      }
      // Trust the local result only if it is clearly inside the window.
      const edge = Math.abs(bestSegment - hint);
      const wrappedEdge = Math.min(edge, n - edge);
      if (wrappedEdge < window) {
        projectSegment(bestSegment, px, pz, out);
        return out;
      }
    }

    bestSq = Infinity;
    bestSegment = 0;
    for (let i = 0; i < n; i++) {
      const d = projectSegment(i, px, pz, null);
      if (d < bestSq) {
        bestSq = d;
        bestSegment = i;
      }
    }
    projectSegment(bestSegment, px, pz, out);
    return out;
  }

  /** Point at arc length `s` (wrapped), written into `out`. */
  function sample(s, out = probe) {
    const target = wrap(s);
    // cum is monotonic → binary search
    let lo = 0;
    let hi = n;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid;
      else hi = mid;
    }
    const i = Math.min(lo, n - 1);
    const j = (i + 1) % n;
    const segLen = Math.max(cum[i + 1] - cum[i], 1e-9);
    const t = (target - cum[i]) / segLen;
    out.segment = i;
    out.t = t;
    out.x = xs[i] + (xs[j] - xs[i]) * t;
    out.z = zs[i] + (zs[j] - zs[i]) * t;
    out.s = target;
    return out;
  }

  const curveA = createResult();
  const curveB = createResult();
  const curveC = createResult();

  /** 0 = straight, 1 = hairpin. Used to decide braking points. */
  function curvature(s, span) {
    const half = Math.max(2.5, span);
    sample(s - half, curveA);
    sample(s, curveB);
    sample(s + half, curveC);
    let ax = curveB.x - curveA.x;
    let az = curveB.z - curveA.z;
    let bx = curveC.x - curveB.x;
    let bz = curveC.z - curveB.z;
    const la = Math.hypot(ax, az) || 1;
    const lb = Math.hypot(bx, bz) || 1;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    let dot = ax * bx + az * bz;
    dot = dot < -1 ? -1 : dot > 1 ? 1 : dot;
    return Math.min(1, Math.acos(dot) / (Math.PI * 0.6));
  }

  return {
    length: n,
    totalLength,
    xs,
    zs,
    nearest,
    sample,
    curvature,
    wrap,
    pointAt: (i) => ({ x: xs[i % n], z: zs[i % n] }),
  };
}

/** The mutable record every query writes into — one per call site, reused forever. */
export function createResult() {
  return {
    segment: 0,
    t: 0,
    x: 0,
    z: 0,
    s: 0,
    distSq: 0,
    distance: 0,
    tangentX: 0,
    tangentZ: 1,
    side: 0,
  };
}
