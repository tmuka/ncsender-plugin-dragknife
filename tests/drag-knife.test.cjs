const test = require('node:test');
const assert = require('node:assert');
const DK = require('../lib/drag-knife.cjs');
const { compare } = require('./sim.cjs');

const R = 0.25;
const cfg = { offset: R };
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
  const res = DK.process(square, { offset: R, liftAngle: 45 });
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
  assert.throws(() => DK.process(prog(['G0 X0 Y0', 'G1 Z-0.3', 'M3 S1000', 'G1 X5']), cfg), /in the middle of a cut/);
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
  assert.match(lines[1], /^\(dragknife processed: offset 0\.25mm/);
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
