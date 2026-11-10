const test = require('node:test');
const assert = require('node:assert');
const DK = require('../lib/drag-knife.cjs');
const { compare, compareWithLeads } = require('./sim.cjs');

const R = 0.25;
const cfg = { offset: R, leadIn: false };   // corner swivels only; lead-in tests switch them on
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

test('ramp in starts at the surface; closed shapes lift out moving forward', () => {
  const lines = DK.process(square, cfg).text.split('\n');
  const firstCut = lines.findIndex(l => /^G1 Z0\b/.test(l));
  assert.ok(firstCut > 0, 'plunges to the surface, not to depth:\n' + lines.join('\n'));
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

test('a cut that starts at the surface: feed move, not a rapid; overlap at final depth', () => {
  // QuickCut-style: down to Z0, then ramping passes round the same loop
  const t = prog(['G0 X0 Y0', 'G0 Z1', 'G1 Z0 F100', 'G1 X10 Y0 Z-0.1 F500', 'G1 X10 Y10 Z-0.2', 'G1 X0 Y10 Z-0.3', 'G1 X0 Y0 Z-0.4',
    'G1 X10 Y0', 'G1 X10 Y10', 'G1 X0 Y10', 'G1 X0 Y0']);
  const res = DK.process(t, cfg), lines = res.text.split('\n');
  const nudge = lines.findIndex(l => l.startsWith('(dk: cut')) + 1;
  assert.match(lines[nudge], /^G1 X0\.25 Y0 F500$/, lines[nudge]);
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
  const base = { offset: R, leadInAngle: 60 };
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
  // first lead-in: behind (1,0) along +Y by 1.5 mm, plus the offset: Y = (-1.5 + 0.25) / 25.4
  assert.match(res.text, /^G0 X1 Y-0\.0492$/m);
});

// a closed square cut as its own stroke; ccw = anticlockwise
function sq(x0, y0, x1, y1, ccw = true) {
  const pts = ccw ? [[x1, y0], [x1, y1], [x0, y1], [x0, y0]] : [[x0, y1], [x1, y1], [x1, y0], [x0, y0]];
  return [`G0 X${x0} Y${y0}`, 'G1 Z-0.3 F200', ...pts.map(([x, y], i) => `G1 X${x} Y${y}` + (i ? '' : ' F1000')), 'G0 Z5'];
}
const leadsPerCut = (text) => text.split('(dk: cut').slice(1).map(c => (c.match(/^G0 Z1$/gm) || []).length);

test('auto: parts lead in outside, holes keep lead-ins out of the part', () => {
  const base = { offset: R, leadInAngle: 60 };
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
  const on = DK.process(square, { offset: R }).stats;
  assert.ok(on.leadIns > 0, 'default lead-ins: ' + on.leadIns);
  assert.strictEqual(DK.process(square, { offset: R, leadIn: false }).stats.leadIns, 0);
  const old = DK.readSettings({ offset: 0.25, leadInAngle: 0, leadInLength: 11.5 });
  assert.strictEqual(old.leadIn, true); assert.strictEqual(old.leadInAngle, 60); assert.strictEqual(old.leadInLength, 11.5);
  assert.strictEqual(DK.readSettings({ leadIn: false, leadInAngle: 0 }).leadInAngle, 0);
});

test('a back-and-forth ramp-in (QuickCut style) is dropped, not turned into lead-ins', () => {
  // down to Z0, zigzag 0.3 mm forward and back to depth, then a square
  const t = prog(['G0 X0 Y0', 'G1 Z0 F100', 'G1 X0.3 Y0 Z-0.15 F500', 'G1 X0 Y0 Z-0.3', 'G1 X10 Y0', 'G1 X10 Y10', 'G1 X0 Y10', 'G1 X0 Y0']);
  const res = DK.process(t, { offset: R, leadInAngle: 60, protect: 'none' });
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
