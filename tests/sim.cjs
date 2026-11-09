// A small G-code runner and a drag knife model for the tests.
// run(text) -> axis samples [{x, y, z}] every `step` along every move (G0-G3, absolute, G17).
// drag(samples, r, surface) -> where the blade tip was at each sample while in the material.
const { parseLine } = require('../lib/drag-knife.cjs');

function run(text, step = 0.01) {
  let pos = { x: 0, y: 0, z: 10 }, motion = 0, arcAbs = false;
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const p = parseLine(raw);
    if (p.special) continue;
    if (/G53\b/i.test(p.code)) { if (/Z/i.test(p.code)) pos = { ...pos, z: 10 }; continue; } // machine coordinates: treat as up out of the way
    const ax = {}; let isMove = false, gs = [];
    for (const w of p.words) {
      if (w.l === 'G') gs.push(Math.round(w.v * 10) / 10);
      else if ('XYZIJR'.includes(w.l)) { ax[w.l] = w.v; if ('XYZ'.includes(w.l)) isMove = true; }
    }
    for (const g of gs) {
      if ([0, 1, 2, 3].includes(g)) motion = g;
      if (g === 90.1) arcAbs = true;
      if (g === 91.1) arcAbs = false;
      if (g === 91) throw new Error('sim: G91 not supported');
    }
    if (motion >= 2 && (ax.I !== undefined || ax.J !== undefined)) isMove = true;
    if (!isMove) continue;
    const to = { x: ax.X ?? pos.x, y: ax.Y ?? pos.y, z: ax.Z ?? pos.z };
    if (motion < 2) {
      const d = Math.hypot(to.x - pos.x, to.y - pos.y, to.z - pos.z), n = Math.max(1, Math.ceil(d / step));
      for (let i = 1; i <= n; i++) out.push({ x: pos.x + (to.x - pos.x) * i / n, y: pos.y + (to.y - pos.y) * i / n, z: pos.z + (to.z - pos.z) * i / n });
    } else {
      if (ax.R !== undefined) throw new Error('sim: R arcs not supported');
      const c = arcAbs ? { x: ax.I ?? pos.x, y: ax.J ?? pos.y } : { x: pos.x + (ax.I || 0), y: pos.y + (ax.J || 0) };
      const R = Math.hypot(pos.x - c.x, pos.y - c.y);
      const a0 = Math.atan2(pos.y - c.y, pos.x - c.x), a1 = Math.atan2(to.y - c.y, to.x - c.x);
      let s = a1 - a0; const full = Math.hypot(to.x - pos.x, to.y - pos.y) < 1e-7;
      if (motion === 3) { while (s <= 1e-12) s += 2 * Math.PI; if (full) s = 2 * Math.PI; }
      else { while (s >= -1e-12) s -= 2 * Math.PI; if (full) s = -2 * Math.PI; }
      const n = Math.max(2, Math.ceil(Math.abs(s) * R / step));
      for (let i = 1; i <= n; i++) {
        const a = a0 + s * i / n;
        out.push({ x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a), z: pos.z + (to.z - pos.z) * i / n });
      }
    }
    pos = to;
  }
  return out;
}

// The tip trails the axis by r, pulled along (a tractrix). Out of the material
// the blade keeps whatever way it pointed. The blade starts lined up with the
// first move it makes in the material.
function drag(samples, r, surface = 0) {
  const tips = [];
  let tip = null, prev = null;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i];
    if (tip === null) {
      if (a.z < surface - 1e-9) {
        // find the first XY move in the material
        let j = i; while (j < samples.length - 1 && Math.hypot(samples[j + 1].x - a.x, samples[j + 1].y - a.y) < 1e-6) j++;
        const b = samples[Math.min(j + 1, samples.length - 1)], d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        tip = { x: a.x - r * (b.x - a.x) / d, y: a.y - r * (b.y - a.y) / d };
      }
    } else if (a.z < surface - 1e-9) {
      const dx = a.x - tip.x, dy = a.y - tip.y, d = Math.hypot(dx, dy);
      if (d > 1e-12) tip = { x: a.x - r * dx / d, y: a.y - r * dy / d };
    } else {
      tip = { x: tip.x + a.x - prev.x, y: tip.y + a.y - prev.y };
    }
    if (tip && a.z < surface - 1e-9) tips.push({ x: tip.x, y: tip.y, z: a.z, ax: a.x, ay: a.y });
    prev = a;
  }
  return tips;
}

// Distance from p to the nearest point of a path of samples (as segments).
function distToPath(p, path) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
    let t = l2 ? ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(a.x + ex * t - p.x, a.y + ey * t - p.y);
    if (d < best) best = d;
  }
  return best;
}

// Compare: the tip of the processed program against the original program's path.
function compare(original, processed, r, opts = {}) {
  const surface = opts.surface ?? 0;
  const want = run(original, 0.05).filter(s => s.z < surface - 1e-9);
  const tips = drag(run(processed, 0.005), r, surface);
  let maxDev = 0;
  for (const t of tips) maxDev = Math.max(maxDev, distToPath(t, want));
  const corners = (opts.corners || []).map(c => Math.min(...tips.map(t => Math.hypot(t.x - c.x, t.y - c.y))));
  return { maxDev, corners, tips: tips.length };
}

// Like compare, but lead-in cuts are allowed: `zones` are segments {a, b} (the next
// line extended behind a corner), and tips within `slack` of one count as on it.
// Also reports, at each corner, the angle between the blade and the next line's
// direction when the tip first reaches the corner after its lead-in.
function compareWithLeads(original, processed, r, zones, slack, corners, surface = 0) {
  const want = run(original, 0.05).filter(s => s.z < surface - 1e-9);
  const tips = drag(run(processed, 0.005), r, surface);
  const zoneDist = (p) => Math.min(...zones.map(z => distToPath(p, [z.a, z.b])));
  let maxDev = 0, inZones = 0;
  for (const t of tips) {
    const d = distToPath(t, want);
    if (d < 1e-3) continue;
    if (zones.length && zoneDist(t) < slack) { inZones++; continue; }
    maxDev = Math.max(maxDev, d);
  }
  const reach = corners.map(c => {
    let best = Infinity, at = -1;
    tips.forEach((t, i) => { const d = Math.hypot(t.x - c.x, t.y - c.y); if (d < best) { best = d; at = i; } });
    return { dist: best, at };
  });
  const aligned = corners.map((c, i) => {
    // the last sample within 0.02 of the corner: the tip leaving it along the next line
    let idx = -1;
    tips.forEach((t, j) => { if (Math.hypot(t.x - c.x, t.y - c.y) < 0.02) idx = j; });
    if (idx < 0) return 180;
    const t = tips[idx], bx = t.ax - t.x, by = t.ay - t.y;
    return Math.abs(Math.atan2(c.dir.x * by - c.dir.y * bx, c.dir.x * bx + c.dir.y * by)) * 180 / Math.PI;
  });
  return { maxDev, inZones, reach: reach.map(x => x.dist), aligned };
}

module.exports = { run, drag, distToPath, compare, compareWithLeads };
