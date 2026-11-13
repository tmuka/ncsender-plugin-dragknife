const test = require('node:test');
const assert = require('node:assert');
const DK = require('../lib/drag-knife.cjs');
const { compare, compareWithLeads } = require('./sim.cjs');

const R = 0.25;
const cfg = { offset: R, leadIn: false, rampLength: 2, leadInLength: 1.5, lineUp: false };   // corner swivels only; lead-in tests switch them on; the path tests measure the cut, not a line-up
const TOL = 0.02;

function prog(body, units = 'G21') {
  return [units + ' G90 G17', 'G0 Z5', ...body, 'G0 Z5', 'M30'].join('\n') + '\n';
}
const square = prog(['G0 X0 Y0', 'G1 Z-0.3 F200', 'G1 X20 Y0 F1000', 'G1 X20 Y20', 'G1 X0 Y20', 'G1 X0 Y0']);
const squareCorners = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];

test('the simulator sees rounded corners on an unprocessed square', () => {
  const c = compare(square, square, R, { corners: squareCorners });
  // without compensation the tip cuts inside the corners and misses them
  assert.ok(Math.max(...c.corners.slice(1)) > 0.1, 'corners missed by ' + c.corners.join(', '));
});

test('square: tip follows the path and reaches every corner', () => {
  const res = DK.process(square, cfg);
  assert.ok(res.changed);
  assert.strictEqual(res.stats.rewritten, 1);
  assert.strictEqual(res.stats.closed, 1);
  assert.ok(res.stats.swivels >= 4, 'swivels ' + res.stats.swivels);
  const c = compare(square, res.text, R, { corners: squareCorners });
  assert.ok(c.maxDev < TOL, 'max deviation ' + c.maxDev);
  for (const d of c.corners) assert.ok(d < TOL, 'corner missed by ' + d);
});

test('triangle and an open zig-zag with very sharp turns', () => {
  const tri = prog(['G0 X0 Y0', 'G1 Z-0.3 F200', 'G1 X30 Y0 F1000', 'G1 X15 Y25.98', 'G1 X0 Y0']);
  let res = DK.process(tri, cfg), c = compare(tri, res.text, R, { corners: [{ x: 30, y: 0 }, { x: 15, y: 25.98 }] });
  assert.ok(c.maxDev < TOL, 'triangle deviation ' + c.maxDev);
  for (const d of c.corners) assert.ok(d < TOL, 'triangle corner ' + d);

  const zig = prog(['G0 X0 Y0', 'G1 Z-0.3 F200', 'G1 X10 Y2 F1000', 'G1 X0 Y4', 'G1 X10 Y6', 'G1 X0 Y8']);
  res = DK.process(zig, cfg);
  assert.strictEqual(res.stats.closed, 0);
  c = compare(zig, res.text, R, { corners: [{ x: 10, y: 2 }, { x: 0, y: 4 }, { x: 10, y: 6 }, { x: 0, y: 8 }] });
  assert.ok(c.maxDev < TOL, 'zigzag deviation ' + c.maxDev);
  for (const d of c.corners) assert.ok(d < TOL, 'zigzag corner ' + d);
});

test('arcs stay arcs: full circle and a rounded rectangle', () => {
  const circle = prog(['G0 X10 Y0', 'G1 Z-0.3 F200', 'G3 X10 Y0 I-10 J0 F1000']);
  let res = DK.process(circle, cfg);
  assert.match(res.text, /G3 /);
  let c = compare(circle, res.text, R);
  assert.ok(c.maxDev < TOL, 'circle deviation ' + c.maxDev);

  const rr = prog(['G0 X5 Y0', 'G1 Z-0.3 F200', 'G1 X25 Y0 F1000', 'G3 X30 Y5 I0 J5', 'G1 X30 Y15', 'G3 X25 Y20 I-5 J0',
    'G1 X5 Y20', 'G3 X0 Y15 I0 J-5', 'G1 X0 Y5', 'G3 X5 Y0 I5 J0']);
  res = DK.process(rr, cfg);
  assert.strictEqual(res.stats.swivels, 0, 'tangent joins need no swivel');
  c = compare(rr, res.text, R);
  assert.ok(c.maxDev < TOL, 'rounded rect deviation ' + c.maxDev);

  const cw = prog(['G0 X0 Y0', 'G1 Z-0.3 F200', 'G1 X10 Y0 F1000', 'G2 X20 Y0 R5', 'G1 X20 Y10']);
  res = DK.process(cw, cfg);
  c = compare(cw.replace('G2 X20 Y0 R5', 'G2 X20 Y0 I5 J0'), res.text, R, { corners: [{ x: 10, y: 0 }, { x: 20, y: 0 }] });
  assert.ok(c.maxDev < TOL, 'R arc deviation ' + c.maxDev);
  for (const d of c.corners) assert.ok(d < TOL, 'R arc corner ' + d);
});

test('inch programs use the offset in inches', () => {
  const sqIn = prog(['G0 X0 Y0', 'G1 Z-0.01 F8', 'G1 X1 Y0 F40', 'G1 X1 Y1', 'G1 X0 Y1', 'G1 X0 Y0'], 'G20');
  const res = DK.process(sqIn, cfg);
  assert.strictEqual(res.stats.units, 'in');
  const c = compare(sqIn, res.text, R / 25.4, { corners: [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] });
  assert.ok(c.maxDev < TOL / 25.4, 'deviation ' + c.maxDev);
  for (const d of c.corners) assert.ok(d < TOL / 25.4, 'corner ' + d);
});

test('lifted swivels rise during the turn and still cut the right shape', () => {
  const res = DK.process(square, { ...cfg, liftAngle: 45 });
  assert.ok(res.stats.lifted >= 4);
  assert.match(res.text, /G3 X[-\d.]+ Y[-\d.]+ Z-0\.15 I/, 'a helical swivel up to half depth');
  const c = compare(square, res.text, R, { corners: squareCorners });
  assert.ok(c.maxDev < TOL, 'deviation ' + c.maxDev);
  for (const d of c.corners) assert.ok(d < TOL, 'corner ' + d);
});

test('ramp in starts at the surface, from Hop height; closed shapes lift out moving forward', () => {
  const lines = DK.process(square, cfg).text.split('\n');
  const firstCut = lines.findIndex(l => /^G1 Z0\b/.test(l));
  assert.ok(firstCut > 0, 'plunges to the surface, not to depth:\n' + lines.join('\n'));
  assert.match(lines[firstCut - 1], /^G0 Z1$/, 'rapid only down to Hop height');
  assert.ok(!lines.some(l => /^G1 Z-0\.3 F200/.test(l)), 'no straight plunge to depth');
  const liftOut = lines.findIndex(l => /^G1 X[-\d.]+ Y[-\d.]+ Z0\b/.test(l));
  assert.ok(liftOut > firstCut, 'lift out while moving');
});

test('programs and parts it leaves alone', () => {
  const travel = prog(['G0 X10 Y10', 'G0 X0 Y0']);
  assert.strictEqual(DK.process(travel, cfg).changed, false);

  const poke = prog(['G0 X1 Y1', 'G1 Z-1 F100', 'G0 Z5', 'G0 X0 Y0', 'G1 Z-0.3', 'G1 X10 F500']);
  const out = DK.process(poke, cfg).text;
  assert.match(out, /G1 Z-1 F100\nG0 Z5/, 'the poke is kept as written');

  const processed = DK.process(square, cfg).text;
  assert.throws(() => DK.process(processed, cfg), /already been processed/);

  assert.throws(() => DK.process(prog(['G0 X0 Y0', 'G1 Z-0.3', 'G91 G1 X5']), cfg), /Line \d+: incremental/);
  assert.throws(() => DK.process(prog(['G0 X0 Y0', 'G1 Z-0.3', 'M8', 'G1 X5']), cfg), /in the middle of a cut/);
  assert.throws(() => DK.process(prog(['G0 X0 Y0', 'G41 G1 Z-0.3', 'G1 X5']), cfg), /compensation/);
});

test('modal state after a cut matches the original', () => {
  // the line after the cut relies on G0 being modal from the retract
  const t = prog(['G0 X0 Y0', 'G1 Z-0.3 F200', 'G1 X10 F1000', 'G0 Z5', 'X20 Y20', 'G1 Z-0.3', 'G1 X30']);
  const res = DK.process(t, cfg);
  const lines = res.text.split('\n'), i = lines.indexOf('X20 Y20');
  assert.ok(i > 0);
  assert.match(lines[i - 1], /^G0 /, 'G0 is the mode before the bare X20 Y20: ' + lines[i - 1]);
});

test('percent line stays first; header names the settings', () => {
  const res = DK.process('%\n' + square + '%\n', cfg);
  const lines = res.text.split('\n');
  assert.strictEqual(lines[0], '%');
  assert.match(lines[1], /^\(dragknife processed: program in mm, offset 0\.25mm/);
});

test('every line written fits Grbl, grblHAL and FluidNC: short, plain ASCII, no realtime characters', () => {
  const long = 'M3 S18000 ; Spindle on! Is it up to speed? ~ a very long comment that goes on and on past any line buffer';
  const t = ['%', long, 'G0 Z5', 'G0 X0 Y0', 'G1 Z-0.3 F200', 'G1 X10 F1000', 'G1 X10 Y10', 'G1 X0 Y10', 'G1 X0 Y0', 'G0 Z5', 'M30'].join('\n') + '\n';
  const res = DK.process(t, { ...cfg, leadIn: true, leadInAngle: 60, liftAngle: 30 }, { source: 'a-really-long-file-name (copy) from quickcut rectangle profile, final ¡v2!.nc' });
  const orig = new Set(t.split('\n'));
  for (const l of res.text.split('\n').filter(l => !orig.has(l))) {
    assert.ok(l.length <= 79, l.length + ': ' + l);
    assert.ok(/^[\x20-\x7e]*$/.test(l) && !/[!?~]/.test(l), l);
  }
  assert.match(res.text, /^; M3 S18000 ; Spindle on Is it up to speed .*\.\.\.  \(removed by Drag Knife\)$/m);
  assert.match(res.text, /^\(dragknife .*from a-really-long-file-name copy/m);
  assert.throws(() => DK.process(res.text, cfg), /already been processed/);
});

test('a cut that starts at the surface: its touch-down is left out; overlap at final depth', () => {
  // QuickCut-style: down to Z0, then ramping passes round the same loop
  const t = prog(['G0 X0 Y0', 'G0 Z1', 'G1 Z0 F100', 'G1 X10 Y0 Z-0.1 F500', 'G1 X10 Y10 Z-0.2', 'G1 X0 Y10 Z-0.3', 'G1 X0 Y0 Z-0.4',
    'G1 X10 Y0', 'G1 X10 Y10', 'G1 X0 Y10', 'G1 X0 Y0']);
  const res = DK.process(t, cfg), lines = res.text.split('\n');
  const nudge = lines.findIndex(l => l.startsWith('(dk: cut')) + 1;
  // the program's G1 Z0 at the start is gone: over at Z1, then ramps in from there
  assert.match(lines[nudge], /^G0 X0\.25 Y0$/, lines[nudge]);
  assert.doesNotMatch(res.text, /^G1 Z0 F100$/m);
  const cuts = lines.filter(l => /^G[123] .*X/.test(l));
  const lastZ = cuts.slice(-4).map(l => (l.match(/Z(-?[\d.]+)/) || [])[1]).filter(Boolean);
  assert.ok(lastZ.every(z => Number(z) <= -0.4 + 1e-9 || Number(z) === 0), 'overlap at full depth then lift: ' + lastZ);
  const c = compare(t, res.text, R, { corners: [{ x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] });
  assert.ok(c.maxDev < TOL, 'deviation ' + c.maxDev);
  for (const d of c.corners) assert.ok(d < TOL, 'corner ' + d);
});

test('spindle starts and speeds are removed; M5 and M30 stay', () => {
  const t = ['G21 G90 G17', 'M6 T27 ; Tool change', 'M3 S18000 ; Start spindle', 'G4 P2', 'G0 Z5', 'G0 X0 Y0', 'G1 Z-0.3 F200',
    'G1 X10 F1000', 'G1 X10 Y10', 'G0 Z5', 'S12000M4', 'M5 ; Stop spindle', 'M30'].join('\n') + '\n';
  const res = DK.process(t, cfg), out = res.text;
  assert.strictEqual(res.stats.spindleRemoved, 2);
  assert.ok(!/^[^(;]*\bM0*[34](?![\d.])/m.test(out.replace(/\([^)]*\)/g, '')), 'no M3/M4 left:\n' + out);
  assert.ok(!/^[^(;]*S\d/m.test(out.replace(/\([^)]*\)/g, '')), 'no S words left');
  assert.match(out, /^; M3 S18000 ; Start spindle  \(removed by Drag Knife\)$/m);
  assert.match(out, /^; S12000M4  \(removed by Drag Knife\)$/m);
  // part of a line: the rest stays, the original follows commented out
  const part = DK.process(prog(['G0 X0 Y0 S500', 'G1 Z-0.3 F200', 'G1 X5 F500']), cfg).text;
  assert.match(part, /^G0 X0 Y0 ; G0 X0 Y0 S500  \(Drag Knife removed S500\)$/m);
  // the commented-out lines are comments to the parser too: nothing to strip a second time
  for (const l of out.split('\n').filter(l => l.startsWith(';'))) assert.strictEqual(DK.parseLine(l).words.length, 0, l);
  assert.match(out, /^M5 ; Stop spindle$/m);
  assert.match(out, /^M30$/m);
  assert.match(out, /^M6 T27/m);
  assert.match(out.split('\n').slice(0, 4).join('\n'), /spindle removed/);

  const kept = DK.process(t, { ...cfg, stripSpindle: false });
  assert.strictEqual(kept.stats.spindleRemoved, 0);
  assert.match(kept.text, /^M3 S18000 ; Start spindle$/m);
  // M3 in the middle of a cut stops processing only when it's kept
  const mid = prog(['G0 X0 Y0', 'G1 Z-0.3', 'M3 S1000', 'G1 X5']);
  assert.throws(() => DK.process(mid, { ...cfg, stripSpindle: false }), /in the middle of a cut/);
  assert.ok(DK.process(mid, cfg).changed);
});

test('lead-in corners: hop, lead in along the next line, blade lined up at the corner', () => {
  const set = { offset: R, leadInAngle: 60, leadInLength: 1.5, hopHeight: 1, protect: 'inside' };
  const res = DK.process(square, set);
  // the square goes anticlockwise: every corner is convex, every extension is outside
  assert.strictEqual(res.stats.leadIns, 4, 'lead-ins ' + res.stats.leadIns);
  assert.strictEqual(res.stats.swivels, 0);
  assert.match(res.text, /^G0 Z1$/m, 'hops to 1 mm above the top');
  // corners in cut order, with the direction of the line after each
  const corners = [{ x: 20, y: 0, dir: { x: 0, y: 1 } }, { x: 20, y: 20, dir: { x: -1, y: 0 } }, { x: 0, y: 20, dir: { x: 0, y: -1 } },
    { x: 0, y: 0, dir: { x: 1, y: 0 } }]; // the closing corner leads into the recut start
  const zones = corners.map(c => ({ a: { x: c.x - c.dir.x * 1.5, y: c.y - c.dir.y * 1.5 }, b: c }));
  const c = compareWithLeads(square, res.text, R, zones, 1.5 * R, corners);
  assert.ok(c.maxDev < TOL, 'off the path outside the lead-in zones by ' + c.maxDev);
  assert.ok(c.inZones > 0, 'the lead-ins were cut');
  for (const d of c.reach) assert.ok(d < TOL, 'corner missed by ' + d);
  for (const a of c.aligned) assert.ok(a < 3, 'blade ' + a.toFixed(1) + '° off the next line at the corner');
});

test('lead-in corners respect the protected side', () => {
  // anticlockwise L-shape with one concave corner at (10,10)
  const ell = prog(['G0 X0 Y0', 'G1 Z-0.3 F200', 'G1 X20 Y0 F1000', 'G1 X20 Y10', 'G1 X10 Y10', 'G1 X10 Y20', 'G1 X0 Y20', 'G1 X0 Y0']);
  const base = { offset: R, leadInAngle: 60, leadInLength: 1.5, rampLength: 2 };
  const inside = DK.process(ell, { ...base, protect: 'inside' }).stats;
  const outside = DK.process(ell, { ...base, protect: 'outside' }).stats;
  const none = DK.process(ell, { ...base, protect: 'none' }).stats;
  // corners met: (20,0) (20,10) (10,10)concave (10,20) (0,20) and the close at (0,0)
  assert.deepStrictEqual([inside.leadIns, inside.swivels], [5, 1], 'protect inside: the concave corner swivels');
  assert.deepStrictEqual([outside.leadIns, outside.swivels], [1, 5], 'protect outside: only the concave corner leads in');
  assert.deepStrictEqual([none.leadIns, none.swivels], [6, 0]);
  // the same shape clockwise: the concave corner is a left turn now, same answer
  const cw = prog(['G0 X0 Y0', 'G1 Z-0.3 F200', 'G1 X0 Y20 F1000', 'G1 X10 Y20', 'G1 X10 Y10', 'G1 X20 Y10', 'G1 X20 Y0', 'G1 X0 Y0']);
  assert.strictEqual(DK.process(cw, { ...base, protect: 'inside' }).stats.leadIns, 5);
  // open paths: no inside or outside, so they swivel unless nothing is protected
  const zig = prog(['G0 X0 Y0', 'G1 Z-0.3 F200', 'G1 X10 Y2 F1000', 'G1 X0 Y4', 'G1 X10 Y6']);
  assert.strictEqual(DK.process(zig, { ...base, protect: 'inside' }).stats.leadIns, 0);
  assert.strictEqual(DK.process(zig, { ...base, protect: 'none' }).stats.leadIns, 2);
  // lead-in corners don't also lift
  const both = DK.process(square, { ...base, protect: 'inside', liftAngle: 45 }).stats;
  assert.deepStrictEqual([both.leadIns, both.lifted], [4, 0]);
});

test('lead-ins in inch programs scale the length and hop', () => {
  const sqIn = prog(['G0 X0 Y0', 'G1 Z-0.01 F8', 'G1 X1 Y0 F40', 'G1 X1 Y1', 'G1 X0 Y1', 'G1 X0 Y0'], 'G20');
  const res = DK.process(sqIn, { offset: R, leadInAngle: 60, leadInLength: 1.5, hopHeight: 1 });
  assert.strictEqual(res.stats.leadIns, 4);
  assert.match(res.text, /^G0 Z0\.0394$/m);
  // first lead-in starts 1.5 mm behind (1,0) along +Y: Y = -1.5 / 25.4. The blade still points
  // +X (the side just cut), so the axis lands 0.25 mm on along X and turns round that point.
  assert.match(res.text, /^G0 X1\.0098 Y-0\.0591$/m);
  // without the turn: the axis lands on the lead-in line, offset ahead: Y = (-1.5 + 0.25) / 25.4
  const plain = DK.process(sqIn, { offset: R, leadInAngle: 60, leadInLength: 1.5, hopHeight: 1, startTurn: false });
  assert.match(plain.text, /^G0 X1 Y-0\.0492$/m);
});

// a closed square cut as its own stroke; ccw = anticlockwise
function sq(x0, y0, x1, y1, ccw = true) {
  const pts = ccw ? [[x1, y0], [x1, y1], [x0, y1], [x0, y0]] : [[x0, y1], [x1, y1], [x1, y0], [x0, y0]];
  return [`G0 X${x0} Y${y0}`, 'G1 Z-0.3 F200', ...pts.map(([x, y], i) => `G1 X${x} Y${y}` + (i ? '' : ' F1000')), 'G0 Z5'];
}
// lead-in hops: up to Hop height, then over (not the way down to it before a ramp)
const leadsPerCut = (text) => text.split('(dk: cut').slice(1).map(c => (c.match(/^G0 Z1\nG0 X/gm) || []).length);

test('auto: parts lead in outside, holes keep lead-ins out of the part', () => {
  const base = { offset: R, leadInAngle: 60, leadInLength: 1.5, rampLength: 2 };
  assert.strictEqual(DK.DEFAULTS.protect, 'auto');
  for (const holeCcw of [true, false]) {
    const t = prog([...sq(0, 0, 40, 40), ...sq(10, 10, 30, 30, holeCcw), ...sq(15, 15, 25, 25)]);
    const res = DK.process(t, base);
    // part: 4 corners + the close; hole: none (every slit would cut the part); island: a part again
    assert.deepStrictEqual(leadsPerCut(res.text), [4, 0, 4], 'hole drawn ' + (holeCcw ? 'anticlockwise' : 'clockwise'));
    assert.strictEqual(res.stats.holes, 1);
    assert.deepStrictEqual(res.stats.autoProblems, []);
  }
  // manual "inside" treats the hole as a part too: its slits would cut into the part around it
  const manual = DK.process(prog([...sq(0, 0, 40, 40), ...sq(10, 10, 30, 30)]), { ...base, protect: 'inside' });
  assert.deepStrictEqual(leadsPerCut(manual.text), [4, 4]);
  // the same outline cut twice (two depths): both are parts, neither is a hole
  const twice = DK.process(prog([...sq(0, 0, 20, 20), ...sq(0, 0, 20, 20)]), base);
  assert.strictEqual(twice.stats.holes, 0);
  assert.deepStrictEqual(leadsPerCut(twice.text), [4, 4]);
});

test('lead-ins are on by default; the switch turns them off; old saved settings (angle 0) get the default', () => {
  const on = DK.process(square, { offset: R, leadInLength: 1.5, rampLength: 2 }).stats;
  assert.ok(on.leadIns > 0, 'default lead-ins: ' + on.leadIns);
  assert.strictEqual(DK.process(square, { offset: R, leadIn: false }).stats.leadIns, 0);
  const old = DK.readSettings({ offset: 0.25, leadInAngle: 0, leadInLength: 11.5 });
  assert.strictEqual(old.leadIn, true); assert.strictEqual(old.leadInAngle, 60); assert.strictEqual(old.leadInLength, 11.5);
  assert.strictEqual(DK.readSettings({ leadIn: true, leadInAngle: 0 }).leadInAngle, 60, 'switched on with a 0 angle: the default');
  assert.strictEqual(DK.process(square, { offset: R, leadIn: true, leadInAngle: 0 }).stats.leadIns > 0, true);
  assert.strictEqual(DK.process(square, { offset: R, leadIn: false, leadInAngle: 0 }).stats.leadIns, 0);
});

test('a back-and-forth ramp-in (QuickCut style) is dropped, not turned into lead-ins', () => {
  // down to Z0, zigzag 0.3 mm forward and back to depth, then a square
  const t = prog(['G0 X0 Y0', 'G1 Z0 F100', 'G1 X0.3 Y0 Z-0.15 F500', 'G1 X0 Y0 Z-0.3', 'G1 X10 Y0', 'G1 X10 Y10', 'G1 X0 Y10', 'G1 X0 Y0']);
  const res = DK.process(t, { offset: R, leadInAngle: 60, leadInLength: 1.5, rampLength: 2, protect: 'none' });
  assert.strictEqual(res.stats.rampsDropped, 1);
  assert.strictEqual(res.stats.leadIns, 4, 'only the square\'s corners lead in (the closing one too)');
  // without lead-ins, the tip follows the wanted path, ramp included
  const c = compare(t, DK.process(t, cfg).text, R);
  assert.ok(c.maxDev < TOL, 'deviation ' + c.maxDev);
});

test('analyze says when auto can\'t decide, and what to choose', () => {
  const ok = DK.analyze(prog([...sq(0, 0, 40, 40), ...sq(10, 10, 30, 30)]), {});
  assert.deepStrictEqual([ok.shapes, ok.holeCount, ok.problems, ok.suggest], [2, 1, [], null]);

  const open = DK.analyze(prog(['G0 X0 Y0', 'G1 Z-0.3 F200', 'G1 X10 Y2 F1000', 'G1 X0 Y4', 'G1 X10 Y6']), {});
  assert.strictEqual(open.suggest, 'none');
  assert.match(open.problems[0], /1 open path has 2 sharp corners/);

  const overlap = DK.analyze(prog([...sq(0, 0, 20, 20), ...sq(10, 10, 40, 40)]), {});
  assert.strictEqual(overlap.overlaps, 1);
  assert.match(overlap.problems.join(' '), /overlaps another/);
  assert.strictEqual(overlap.suggest, 'inside');

  const bowtie = DK.analyze(prog(['G0 X0 Y0', 'G1 Z-0.3 F200', 'G1 X20 Y20 F1000', 'G1 X20 Y0', 'G1 X0 Y20', 'G1 X0 Y0']), {});
  assert.strictEqual(bowtie.selfCrossing, 1);
  assert.match(bowtie.problems.join(' '), /crosses itself/);

  // open paths beside shapes: reported, but no single manual choice suits both
  const mixed = DK.analyze(prog([...sq(0, 0, 20, 20), 'G0 X30 Y0', 'G1 Z-0.3', 'G1 X40 Y2', 'G1 X30 Y4', 'G0 Z5']), {});
  assert.strictEqual(mixed.problems.length, 1);
  assert.strictEqual(mixed.suggest, null);
  // process() carries the same problems into its stats
  assert.strictEqual(DK.process(prog([...sq(0, 0, 20, 20), ...sq(10, 10, 40, 40)]), { offset: R, leadInAngle: 60 }).stats.autoProblems.length, 1);
});

test('a big program runs quickly', () => {
  const body = ['G0 X0 Y0'];
  for (let i = 0; i < 2000; i++) {
    const x = (i % 50) * 25, y = Math.floor(i / 50) * 25;
    body.push(`G0 X${x} Y${y}`, 'G1 Z-0.3 F200', `G1 X${x + 20} Y${y} F1000`, `G1 X${x + 20} Y${y + 20}`, `G1 X${x} Y${y + 20}`, `G1 X${x} Y${y}`, 'G0 Z5');
  }
  const t0 = Date.now(), res = DK.process(prog(body), cfg);
  assert.strictEqual(res.stats.rewritten, 2000);
  assert.ok(Date.now() - t0 < 2000, 'took ' + (Date.now() - t0) + ' ms');
});

// ---- review fixes (2026-11-10) ----
const sqDeep = ['G0 X0 Y0', 'G1 Z-1 F200', 'G1 X10 Y0 F1000', 'G1 X10 Y10', 'G1 X0 Y10', 'G1 X0 Y0'];
function deepestNear(text, x, y, rad, r = R) {
  const { run, drag } = require('./sim.cjs');
  const tips = drag(run(text, 0.005), r);
  return Math.min(...tips.filter(t => Math.hypot(t.x - x, t.y - y) < rad).map(t => t.z));
}

test('M3.0, M03.00 and M4.0 are spindle starts too', () => {
  for (const l of ['M3.0 S1000', 'M03.00', 'M4.0', 'M3 . 0 S500']) {
    const out = DK.process(prog([l, ...sqDeep]), cfg).text;
    const live = out.split('\n').map(x => x.replace(/\([^)]*\)|;.*$/g, '')).filter(x => /M\s*0*[34]\b|M\s*0*[34]\s*\./i.test(x));
    assert.deepStrictEqual(live, [], l + ' left a spindle start:\n' + out);
  }
});

test('spindle starts come out even when no cut is rewritten', () => {
  for (const set of [{ offset: 0 }, { offset: R, surfaceZ: -5 }]) {
    const res = DK.process(prog(['M3 S1000', ...sqDeep]), set);
    assert.strictEqual(res.changed, true, JSON.stringify(set));
    assert.strictEqual(res.stats.rewritten, 0);
    assert.ok(!/^M3 S1000$/m.test(res.text), 'M3 still live with ' + JSON.stringify(set));
  }
  assert.strictEqual(DK.process(prog(sqDeep), { offset: 0 }).changed, false, 'nothing to do, no spindle: unchanged');
});

test('words the rewrite would drop from a cutting move are refused', () => {
  const at = (l) => () => DK.process(prog(['G0 X0 Y0', 'G1 Z-1 F200', 'G1 X10 Y0 F1000', l, 'G1 X0 Y10', 'G0 Z5']), cfg);
  assert.throws(at('G55 G1 X10 Y10'), /G55 on a cutting move/);
  assert.throws(at('G1 X10 Y10 M8'), /M on a cutting move/);
  assert.throws(at('G93 G1 X10 Y10 F60'), /G93 on a cutting move/);
  assert.throws(at('G90.1 G1 X10 Y10'), /G90\.1/);
  assert.ok(DK.process(prog(['G0 X0 Y0', 'G1 Z-1 F200', 'G90 G17 G1 X10 Y0 F1000', 'G1 X10 Y10', 'G0 Z5']), cfg).changed, 'harmless words still fine');
});

test('the overcut is at full depth even when the last move ramps out', () => {
  const t = prog(['G0 X0 Y0', 'G1 Z-1 F200', 'G1 X10 Y0 F1000', 'G1 X10 Y10', 'G1 X0 Y10', 'G1 X0 Y0 Z0']);
  const d = deepestNear(DK.process(t, cfg).text, 1, 0, 0.2);
  assert.ok(d <= -1 + 1e-6, 'deepest near the start ' + d);
});

test('small closed shapes and short open cuts still reach full depth', () => {
  const tiny = prog(['G0 X0 Y0', 'G1 Z-1 F200', 'G1 X0.4 Y0 F1000', 'G1 X0.4 Y0.4', 'G1 X0 Y0.4', 'G1 X0 Y0']);
  const res = DK.process(tiny, { offset: 0.05, rampLength: 2, leadIn: false });
  for (const [x, y] of [[0.1, 0], [0.3, 0], [0.4, 0.2]]) assert.ok(deepestNear(res.text, x, y, 0.04, 0.05) <= -1 + 1e-6, 'tiny square at ' + x + ',' + y);
  assert.strictEqual(res.stats.shortRamps, 1);
  const slit = DK.process(prog(['G0 X0 Y0', 'G1 Z-1 F200', 'G1 X1 Y0 F1000']), { offset: R, rampLength: 2 });
  assert.ok(slit.text.split('\n').some(l => /^G1 X[\d.]+ Y0 Z-1\b/.test(l) || /Z-1$/.test(l)), 'reaches Z-1:\n' + slit.text);
});

test('a partly stripped line stays within 79 characters; copied comments are plain', () => {
  const l = 'N12345 G1 X-123.4567 Y-123.4567 Z12.3456 F1234.5 S24000 M3';
  const outL = DK.stripSpindleWords(l);
  assert.ok(outL.length <= 79, outL.length + ': ' + outL);
  assert.ok(!/S24000|M3\b/.test(outL.replace(/\([^)]*\)|;.*$/g, '')));
  const t = prog(['G0 X0 Y0', 'G1 Z-1 F200', 'G1 X10 Y0 F1000 (careful! is it ok? ~ ' + 'x'.repeat(90) + ')', 'G1 X10 Y10', 'G0 Z5']);
  for (const line of DK.process(t, cfg).text.split('\n').filter(x => x.startsWith('('))) {
    assert.ok(line.length <= 79 && !/[!?~]/.test(line), line);
  }
});

test('auto nesting stays quick with hundreds of shapes', () => {
  const body = [];
  for (let i = 0; i < 400; i++) {
    const cx = (i % 20) * 30, cy = Math.floor(i / 20) * 30, rr = 5 + (i % 7);
    body.push('G0 X' + (cx + rr) + ' Y' + cy, 'G1 Z-0.3 F200');
    for (let k = 1; k <= 200; k++) { const a = 2 * Math.PI * k / 200; body.push('G1 X' + (cx + rr * Math.cos(a)).toFixed(3) + ' Y' + (cy + rr * Math.sin(a)).toFixed(3)); }
    body.push('G0 Z5');
  }
  const t0 = Date.now();
  DK.process(prog(body), { offset: R, leadIn: true, protect: 'auto' });
  assert.ok(Date.now() - t0 < 2500, 'took ' + (Date.now() - t0) + ' ms');
});

test('results name their source', () => {
  const out = DK.process(prog(sqDeep), cfg, { source: 'QuickCut/part (2).nc' }).text;
  assert.strictEqual(DK.processedFrom(out), DK.sourceLabel('QuickCut/part (2).nc'));
});

test('defaults suit a large-format CNC drag knife: 6 mm offset, lead-in 18 mm, ramp 12 mm', () => {
  const d = DK.readSettings({});
  assert.deepStrictEqual([d.offset, d.leadInLength, d.rampLength, d.leadIn, d.leadInAngle], [6, 18, 12, true, 60]);
});

test('a closed shape entered by a ramp along its own path (ncCAM) is closed, not open', () => {
  // start 3 mm before the corner on the last edge, ramp down to it, go round, end at the corner
  const t = prog(['G0 X0 Y3', 'G0 Z1', 'G1 Z0 F100', 'G1 X0 Y0 Z-0.3 F500', 'G1 X10 Y0', 'G1 X10 Y10', 'G1 X0 Y10', 'G1 X0 Y0']);
  const res = DK.process(t, cfg);
  assert.strictEqual(res.stats.closed, 1);
  assert.strictEqual(res.stats.rampsDropped, 1);
  const c = compare(t, res.text, R, { corners: [{ x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] });
  assert.ok(c.maxDev < TOL, 'deviation ' + c.maxDev);
  for (const d of c.corners) assert.ok(d < TOL, 'corner ' + d);
  assert.ok(deepestNear(res.text, 1, 0, 0.2) <= -0.3 + 1e-6, 'start recut at full depth');
  // an open path that happens to end near its start is left open
  assert.strictEqual(DK.process(prog(['G0 X0 Y0', 'G1 Z-0.3 F200', 'G1 X10 Y0 F1000', 'G1 X10 Y10', 'G1 X0.5 Y0.2']), cfg).stats.closed, 0);
});

// ---------- the offset test ----------
const { run, drag } = require('./sim.cjs');
function inPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p.y) !== (b[1] > p.y) && p.x < (b[0] - a[0]) * (p.y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function tileProgram(t, size, depth = 0.3) {
  const pts = DK.testTile(t.x, t.y, size);
  return prog(['G0 X' + pts[0][0] + ' Y' + pts[0][1], 'G1 Z-' + depth + ' F200', ...pts.slice(1).map(p => 'G1 X' + p[0] + ' Y' + p[1] + ' F1000')]);
}

test('offset test: offsets centred on the guess, all above 0', () => {
  assert.deepStrictEqual(DK.testOffsets(6, 0.9, 5), [4.2, 5.1, 6, 6.9, 7.8]);
  assert.deepStrictEqual(DK.testOffsets(0.25, 0.05, 3), [0.2, 0.25, 0.3]);
  const low = DK.testOffsets(0.25, 0.1, 7);
  assert.ok(low.every(o => o > 0), 'all positive: ' + low);
  assert.strictEqual(low.length, 7);
});

test('offset test: each tile, processed with its own offset, is cut as drawn', () => {
  // swivels only, so the simulator compares the tip with the tile directly
  for (const o of [0.25, 2]) {
    const t = DK.offsetTest({ offsets: [o], size: 10, depth: 0.3 }, { leadIn: false, rampLength: 2 });
    const tile = t.tiles[0], want = tileProgram(tile, 10);
    const tips = drag(run(t.text, 0.005), o);
    const pts = DK.testTile(tile.x, tile.y, 10);
    const onTile = tips.filter(p => p.y > tile.y - 0.5);   // the ticks are below the tile
    const wantS = run(want, 0.05).filter(s => s.z < 0);
    const { distToPath } = require('./sim.cjs');
    const dev = Math.max(...onTile.map(p => distToPath(p, wantS)));
    assert.ok(dev < TOL, 'offset ' + o + ': tile deviation ' + dev);
    // the sharp point and the square corners are reached
    for (const c of [pts[1], pts[3], pts[5]]) {
      const d = Math.min(...onTile.map(p => Math.hypot(p.x - c[0], p.y - c[1])));
      assert.ok(d < TOL, 'offset ' + o + ': corner ' + c + ' missed by ' + d);
    }
  }
});

test('offset test: n ticks under tile n, tile 0 uncorrected, a processed program within the line rules', () => {
  const t = DK.offsetTest({ offsets: [4.2, 5.1, 6], size: 18, depth: 0.5, uncorrected: true }, {});
  assert.deepStrictEqual(t.tiles.map(x => x.n), [0, 1, 2, 3]);
  assert.ok(DK.isProcessed(t.text), 'marked processed, so it is not processed again');
  for (const l of t.text.split('\n')) {
    assert.ok(l.length <= 79, 'too long: ' + l);
    assert.ok(!/[^\x20-\x7e]|[!?~]/.test(l), 'not plain: ' + l);
  }
  // count the cuts below each tile: plunges whose X is in the tile's span and Y under it
  const samples = run(t.text, 0.05);
  const plungesAt = [];
  for (let i = 1; i < samples.length; i++) if (samples[i].z < 0 && samples[i - 1].z >= 0) plungesAt.push(samples[i]);
  for (const tile of t.tiles) {
    const under = plungesAt.filter(p => p.x > tile.x + 18 * 0.1 && p.x < tile.x + 18 * 0.9 && p.y < tile.y - 1);
    assert.strictEqual(under.length, tile.n, 'tile ' + tile.n + ' ticks ' + under.length);
  }
  // tile 0 is the raw tile: no hops, a straight plunge
  const zero = t.text.split('(tile 1')[0].split('(tile 0')[1];
  assert.match(zero, /G1 Z-0\.5 F/);
});

test('offset test: no tile cuts into another, with your lead-in settings or not', () => {
  // The test swivels every corner, so the tip stays on each tile's line; allow for the
  // blade lining up at the very start.
  for (const [o, size] of [[6, 18], [0.5, 10]]) {
    const t = DK.offsetTest({ offsets: [o, o, o], size, depth: 0.5 }, o === 6 ? {} : { offset: o, leadInLength: 3, rampLength: 4 });
    const { distToPath } = require('./sim.cjs');
    const tips = drag(run(t.text, 0.01), o);
    let worst = 0;
    for (const tile of t.tiles) {
      const poly = DK.testTile(tile.x, tile.y, size).slice(0, -1), edge = poly.concat([poly[0]]).map(p => ({ x: p[0], y: p[1] }));
      for (const p of tips) if (inPolygon(p, poly)) worst = Math.max(worst, distToPath(p, edge));
    }
    assert.ok(worst < o * 0.3, 'offset ' + o + ': the tip reaches ' + worst.toFixed(3) + ' inside a tile');
    assert.strictEqual(t.text.split('\n').filter(l => /^\(tile /.test(l)).length, 3);
  }
});

test('offset test: steps at least 0.01 mm, no repeats, the row stays centred above 0', () => {
  const a = DK.testOffsets(6, 0.005, 5);
  assert.strictEqual(new Set(a).size, 5, 'repeats: ' + a);
  const b = DK.testOffsets(1, 3, 9);
  assert.ok(b.every(o => o > 0) && b.includes(1), 'centred on 1: ' + b);
  const c = DK.testOffsets(0.25, 0, 5);
  assert.ok(c.includes(0.25) && c.every(o => o > 0), 'auto step: ' + c);
});

test('offset test settings are bounded when read', () => {
  const s = DK.readSettings({ testCount: 100, testDepth: -1, testFeed: 0, testStep: -2, lastTest: 'x;y' });
  assert.strictEqual(s.testCount, 9);
  assert.strictEqual(s.testDepth, DK.DEFAULTS.testDepth);
  assert.strictEqual(s.testFeed, DK.DEFAULTS.testFeed);
  assert.strictEqual(s.testStep, 0);
  assert.strictEqual(s.lastTest, '');
  assert.strictEqual(DK.readSettings({ testCount: 1 }).testCount, 2);
});

test('offset test: cut from Z0 whatever Material top Z says', () => {
  const t = DK.offsetTest({ offsets: [1], size: 10, depth: 0.3 }, { offset: 1, surfaceZ: -2 });
  const zs = t.text.split('\n').map(l => /Z(-?[\d.]+)/.exec(l)).filter(Boolean).map(m => +m[1]);
  assert.strictEqual(Math.min(...zs), -0.3);
  assert.match(t.text, /Z0 its top/);
});

test('offset test: a tile far above your offset is cut as true as one near it', () => {
  // your offset 6; the tile at 9.6 mm gets a ramp of 19.2 mm and swivels its corners
  const t = DK.offsetTest({ offsets: [9.6], size: 39, depth: 0.5 }, {});
  const tips = drag(run(t.text, 0.01), 9.6);
  const { distToPath } = require('./sim.cjs');
  const tile = t.tiles[0], poly = DK.testTile(tile.x, tile.y, 39).slice(0, -1), edge = poly.concat([poly[0]]).map(p => ({ x: p[0], y: p[1] }));
  let worst = 0;
  for (const p of tips) if (inPolygon(p, poly)) worst = Math.max(worst, distToPath(p, edge));
  assert.ok(worst < 9.6 * 0.2, 'the tip reaches ' + worst.toFixed(2) + ' inside');
});

// ---------- the blade remembers its heading ----------
const twoCuts = prog(['G0 X0 Y0', 'G1 Z-0.5 F200', 'G1 X20 Y0 F1000', 'G0 Z5',
  'G0 X40 Y20', 'G1 Z-0.5 F200', 'G1 X40 Y50 F1000', 'G1 X10 Y50', 'G1 X10 Y20', 'G1 X40 Y20']);

test('the next cut turns the blade in place at its start: the tip lands on it and stays on the line', () => {
  const { distToPath } = require('./sim.cjs');
  const want = run(twoCuts, 0.05).filter(s => s.z < 0);
  const offLine = (text) => Math.max(...drag(run(text, 0.01), 6).filter(t => t.y > 15).map(t => distToPath(t, want)));
  const on = DK.process(twoCuts, { offset: 6, leadIn: false });
  assert.strictEqual(on.stats.turns, 1, 'one turn: the first cut has no known heading');
  assert.ok(offLine(on.text) < TOL, 'second cut off the line by ' + offLine(on.text));
  // it turns shallow: a quarter of the depth by default
  assert.match(on.text, /^G1 Z-0\.125\b/m);
  const off = DK.process(twoCuts, { offset: 6, leadIn: false, startTurn: false });
  assert.strictEqual(off.stats.turns, 0);
  assert.ok(offLine(off.text) > 3, 'without it the start drags off the line: ' + offLine(off.text));
});

test('a lead-in after a hop turns in place too, so even a short lead-in lines the blade up', () => {
  const set = { offset: 6, leadInAngle: 60, leadInLength: 1.5, hopHeight: 1, protect: 'none', rampLength: 2, liftOut: 0 };
  const big = prog(['G0 X0 Y0', 'G1 Z-0.5 F200', 'G1 X60 Y0 F1000', 'G1 X60 Y60', 'G1 X0 Y60', 'G1 X0 Y0']);
  const corners = [{ x: 60, y: 0, dir: { x: 0, y: 1 } }, { x: 60, y: 60, dir: { x: -1, y: 0 } }, { x: 0, y: 60, dir: { x: 0, y: -1 } }];
  const zones = corners.map(c => ({ a: { x: c.x - c.dir.x * 1.5, y: c.y - c.dir.y * 1.5 }, b: c }));
  const on = compareWithLeads(big, DK.process(big, set).text, 6, zones, 0.05, corners);
  for (const a of on.aligned) assert.ok(a < 3, 'blade ' + a.toFixed(1) + ' deg off the next side at the corner');
  const off = compareWithLeads(big, DK.process(big, Object.assign({}, set, { startTurn: false })).text, 6, zones, 0.05, corners);
  assert.ok(Math.max(...off.aligned) > 10, 'without the turn a 1.5 mm lead-in can\'t line a 6 mm blade up: ' + off.aligned);
});

test('lift-out follows the shape, even when longer than the side it starts on', () => {
  const { distToPath } = require('./sim.cjs');
  const sq20 = prog(['G0 X0 Y0', 'G1 Z-0.5 F200', 'G1 X20 Y0 F1000', 'G1 X20 Y20', 'G1 X0 Y20', 'G1 X0 Y0']);
  const res = DK.process(sq20, { offset: 2, leadIn: false, rampLength: 4, liftOut: 25.4 });
  const want = run(sq20, 0.05).filter(s => s.z < 0);
  const worst = Math.max(...drag(run(res.text, 0.01), 2).map(t => distToPath(t, want)));
  assert.ok(worst < TOL, 'the tip leaves the square by ' + worst);
  assert.ok(res.stats.liftedAlong >= 1);
});

test('offset test: every corner swivels, and the blade turns in place from tile to tile', () => {
  const t = DK.offsetTest({ offsets: [5, 6, 7], size: 0, depth: 0.5 }, { leadIn: true, leadInLength: 1.5, rampLength: 2, liftOut: 25.4 });
  assert.ok(!/^G0 Z1\nG0 X/m.test(t.text), 'no lead-in hops');
  assert.match(t.text, /corners swivel/);
  assert.ok((t.text.match(/^G[23] /gm) || []).length > 9, 'swivels and turns');
});

test('saved knives: named, cleaned, only the knife settings', () => {
  const s = DK.readSettings({ knives: [
    { name: '  6 mm  tangential ', s: { offset: 4.65, leadInLength: 18, surfaceZ: 3, protect: 'none', bogus: 1 } },
    { name: '6 MM TANGENTIAL', s: { offset: 1 } },        // the same name again: dropped
    { name: '', s: { offset: 1 } },                       // no name: dropped
    { name: 'Vinyl', s: { offset: -2, turnDepth: 7 } },    // read like any settings
    'nonsense'] });
  assert.deepStrictEqual(s.knives.map(k => k.name), ['6 mm tangential', 'Vinyl']);
  assert.deepStrictEqual(Object.keys(s.knives[0].s).sort(), DK.KNIFE_KEYS.slice().sort());
  assert.strictEqual(s.knives[0].s.offset, 4.65);
  assert.strictEqual(s.knives[0].s.rampLength, DK.DEFAULTS.rampLength, 'missing values get the defaults');
  assert.strictEqual(s.knives[1].s.offset, 0);
  assert.strictEqual(s.knives[1].s.turnDepth, 1);
  assert.deepStrictEqual(DK.readSettings({}).knives, []);
  assert.strictEqual(DK.readSettings({ knives: Array.from({ length: 30 }, (_, i) => ({ name: 'k' + i, s: {} })) }).knives.length, 20);
});

// ---------- lining the blade up before the first cut ----------
// a 5-point star like QuickCut's (Z0 first, then down), centred 40 mm in from X0 Y0
function starProg(cx = 40, cy = 40, ro = 25.4, ri = 9.7) {
  const pts = [];
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? ri : ro; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  // start mid-edge, as QuickCut does
  const s0 = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
  const ring = pts.slice(1).concat([pts[0], s0]);
  return { poly: pts, text: prog(['G0 X' + s0[0].toFixed(4) + ' Y' + s0[1].toFixed(4), 'G0 Z2', 'G1 Z0 F60', 'G1 Z-0.05 F60',
    ...ring.map(([x, y], i) => 'G1 X' + x.toFixed(4) + ' Y' + y.toFixed(4) + (i ? '' : ' F1000'))]) };
}

test('the first cut: the blade is lined up in the waste first, so no start mark lands on the part', () => {
  const { distToPath } = require('./sim.cjs');
  const st = starProg(), R6 = 4.56;
  const set = { offset: R6, rampLength: 12, leadInLength: 18 };
  const res = DK.process(st.text, set);
  assert.strictEqual(res.stats.lineUps, 1);
  assert.match(res.text, /\(dk: line up the blade first, in the waste\)/);
  const want = run(st.text, 0.05).filter(s => s.z < 0);
  const poly = st.poly.map(([x, y]) => [x, y]);
  // whichever way the blade pointed before, nothing cuts into the star past the line
  // (a blade starting nearly backwards is a few degrees off after the line-up: a trace
  // under 0.5 mm, at the very top of the ramp)
  for (const deg of [0, 90, 180, 270]) {
    const h0 = { x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180) };
    const tips = drag(run(res.text, 0.02), R6, 0, h0);
    const inside = tips.filter(t => inPolygon(t, poly) && distToPath(t, want) > 0.5);
    assert.strictEqual(inside.length, 0, 'blade from ' + deg + ' deg: ' + inside.length + ' tip samples inside, e.g. ' + JSON.stringify(inside[0]));
  }
  // without it, some starting directions mark the inside
  const plain = DK.process(st.text, Object.assign({ lineUp: false }, set));
  const marks = [90, 180].map(deg => drag(run(plain.text, 0.02), R6, 0, { x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180) })
    .filter(t => inPolygon(t, poly) && distToPath(t, want) > 0.5).length);
  assert.ok(marks.some(n => n > 0), 'the start marks the inside without lining up: ' + marks);
});

test('no line-up where there is no clear waste: a part on X0 Y0 starting on its edge', () => {
  const res = DK.process(square, { offset: 2, leadIn: false, rampLength: 4 });
  assert.ok(!res.stats.lineUps, 'no room below Y0 or beside it inside the square');
  assert.doesNotMatch(res.text, /line up the blade/);
});

test('shapes that start at Z0 (QuickCut) still turn in place: the knife lifts first', () => {
  const two = prog(['G0 X10 Y10', 'G0 Z2', 'G1 Z0 F60', 'G1 Z-0.05', 'G1 X40 Y10 F1000', 'G0 Z2',
    'G0 X60 Y30', 'G1 Z0 F60', 'G1 Z-0.05', 'G1 X60 Y60 F1000', 'G1 X90 Y60', 'G1 X90 Y30', 'G1 X60 Y30']);
  const res = DK.process(two, { offset: 4, leadIn: false, lineUp: false });
  assert.strictEqual(res.stats.turns, 1);
  const lines = res.text.split('\n'), c2 = lines.findIndex(l => l.startsWith('(dk: cut 2'));
  // its G1 Z0 left out: over at the program's travel height (Z2), then down to Hop height
  assert.match(lines[c2 + 1], /^G0 X/, 'goes over from Z2: ' + lines.slice(c2, c2 + 4).join(' / '));
  assert.match(lines[c2 + 2], /^G0 Z1$/, 'down to Hop height: ' + lines.slice(c2, c2 + 5).join(' / '));
  assert.doesNotMatch(lines.slice(c2).join('\n'), /^G1 Z0\b/m, 'no touch-down before the turn');
});

// ---------- where Z0 is ----------
test('Z0: read from the program comment, else from its heights; depth of cut worked out', () => {
  const top = '(Z0: the top of the stock)\n' + prog(['G0 X0 Y0', 'G1 Z-0.3 F200', 'G1 X20 Y0 F1000', 'G1 X20 Y20']);
  let z = DK.readZ(top, {});
  assert.deepStrictEqual([z.mode, z.by, z.surfaceZ, z.depth], ['top', 'comment', 0, 0.3]);
  // QuickCut's planer under the stock, ncCut2D's "on the bed"
  for (const c of ['(Z0: the wasteboard, under the stock)', '(Z0 on the bed)']) {
    z = DK.readZ(c + '\n' + prog(['G0 X0 Y0', 'G1 Z2.8 F200', 'G1 X20 Y0 F1000']), { thickness: 3 });
    assert.deepStrictEqual([z.mode, z.by], ['bottom', 'comment'], c);
    assert.ok(Math.abs(z.depth - 0.2) < 1e-9 && Math.abs(z.bedClearance - 2.8) < 1e-9, JSON.stringify(z));
  }
  // no comment, never below Z0: the bed
  const bed = prog(['G0 X0 Y0', 'G1 Z2.5 F200', 'G1 X20 Y0 F1000', 'G1 X20 Y20', 'G1 X0 Y20', 'G1 X0 Y0']);
  z = DK.readZ(bed, {});
  assert.deepStrictEqual([z.mode, z.by], ['bottom', 'heights']);
  assert.match(z.problem, /Material thickness/);
  assert.throws(() => DK.process(bed, { offset: 2 }), /Material thickness/);
  // with the thickness: cut as a 0.5 mm deep cut from the top at Z3
  const res = DK.process(bed, { offset: 2, thickness: 3, leadIn: false, lineUp: false });
  assert.strictEqual(res.stats.rewritten, 1);
  assert.match(res.text, /^G0 Z4\nG1 Z3\b/m, 'ramps in from the top at Z3, rapid only to Hop height above it');
  // inch program, thickness in mm
  z = DK.readZ('G20 G90\nG0 X0 Y0\nG1 Z0.1 F10\nG1 X1 Y0 F40\n', { zZero: 'bottom', thickness: 3.175 });
  assert.ok(Math.abs(z.surfaceZ - 0.125) < 1e-9 && Math.abs(z.depth - 0.635) < 1e-6, JSON.stringify(z));
  // chosen, not auto; an old saved material top keeps working
  assert.strictEqual(DK.readZ(bed, { zZero: 'top' }).mode, 'top');
  assert.strictEqual(DK.readSettings({ surfaceZ: -5 }).zZero, 'other');
  assert.strictEqual(DK.readZ(bed, { surfaceZ: 4 }).surfaceZ, 4);
});

test('travels added before a cut clear a blade that still touches 1 mm up (spring-loaded, zeroed pressed)', () => {
  // QuickCut-style: travel at Z5, down to Z0 at the start, then cut; a 20 mm square well inside
  const sq = prog(['G0 X30 Y30', 'G0 Z5', 'G0 Z2', 'G1 Z0 F60', 'G1 Z-1', 'G1 X50 Y30 F1000', 'G1 X50 Y50', 'G1 X30 Y50', 'G1 X30 Y30', 'G0 Z5']);
  const res = DK.process(sq, { offset: 4, leadIn: false, rampLength: 8 });
  assert.strictEqual(res.stats.lineUps, 1);
  const { distToPath } = require('./sim.cjs');
  const want = run(sq, 0.05).filter(s => s.z < 0);
  const stray = (surface) => {
    let L = 0, p = null;
    for (const t of drag(run(res.text, 0.02), 4, surface, { x: 1, y: 0 })) {
      if (p && distToPath(t, want) > 0.5 && Math.hypot(t.x - p.x, t.y - p.y) < 0.5) L += Math.hypot(t.x - p.x, t.y - p.y);
      p = t;
    }
    return L;
  };
  // only the line-up itself is off the square, whether the blade clears at Z0 or touches up to Z1.2
  assert.ok(stray(1.2) < stray(0) + 0.5, 'touching up to Z1.2 adds ' + (stray(1.2) - stray(0)).toFixed(1) + ' mm of stray cut');
});
