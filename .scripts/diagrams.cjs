#!/usr/bin/env node
// Draws the README's simulator pictures from the processor and the drag model:
// docs/images/start-turn.svg and docs/images/offset-test.svg.
// node .scripts/diagrams.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const DK = require('../lib/drag-knife.cjs');
const { run, drag, distToPath } = require('../tests/sim.cjs');

const C = { want: '#8a94a6', holder: '#3b82f6', tip: '#0f9d76', off: '#e0911b', text: '#1f2937', note: '#374151', key: '#6b7280', card: '#ffffff', edge: '#d0d5dd' };
const FONT = '-apple-system, Segoe UI, Helvetica, Arial, sans-serif';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// One drawing: the cut you want (dashed), the holder's path (thin, dotted in the air)
// and the tip's cut (green on the line, orange off it), in a box w x h px.
function drawing(want, processed, r, box, opts = {}) {
  const wantS = run(want, 0.05).filter((s) => s.z < 0);
  const axis = run(processed, 0.02);
  const tips = drag(axis, r);
  const pts = wantS.concat(tips, opts.holder ? axis.filter((a) => a.z < 3) : []);
  const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
  const k = Math.min((box.w - 20) / (x1 - x0), (box.h - 20) / (y1 - y0));
  const ox = box.x + (box.w - (x1 - x0) * k) / 2, oy = box.y + (box.h + (y1 - y0) * k) / 2;
  const X = (x) => (ox + (x - x0) * k).toFixed(1), Y = (y) => (oy - (y - y0) * k).toFixed(1);
  // keep a point only when it's 0.7 px from the last one kept (the drawing's scale)
  const near = (a, b) => a && b && Math.hypot(a.x - b.x, a.y - b.y) * k < 0.7;
  let o = '';
  // the cut you want, run by run
  let d = '', prev = null;
  let kept = null;
  for (const s of wantS) {
    const jump = !prev || Math.hypot(s.x - prev.x, s.y - prev.y) > 0.2;
    if (jump || !near(s, kept)) { d += (jump ? 'M' : 'L') + X(s.x) + ' ' + Y(s.y); kept = s; }
    prev = s;
  }
  o += `<path d="${d}" fill="none" stroke="${C.want}" stroke-width="1.5" stroke-dasharray="5 4"/>`;
  if (opts.holder) {
    let seg = [], air = null;
    const flush = () => { if (seg.length > 1) o += `<path d="M${seg.join(' L')}" fill="none" stroke="${C.holder}" stroke-width="1.2"${air ? ' stroke-dasharray="2 3"' : ''} opacity="0.8"/>`; };
    let keptA = null;
    for (const a of axis.filter((q) => q.z < 3)) {
      const isAir = a.z >= 0;
      if (isAir !== air) { flush(); seg = seg.length ? [seg[seg.length - 1]] : []; air = isAir; }
      if (!near(a, keptA)) { seg.push(X(a.x) + ' ' + Y(a.y)); keptA = a; }
    }
    flush();
  }
  // the tip: green where it's on the cut you want, orange where it isn't
  let seg = [], off = null, last = null, keptT = null;
  const flushT = () => { if (seg.length > 1) o += `<path d="M${seg.join(' L')}" fill="none" stroke="${off ? C.off : C.tip}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`; };
  for (const t of tips) {
    const jump = last && Math.hypot(t.x - last.x, t.y - last.y) > 0.5;
    const isOff = distToPath(t, wantS) > (opts.tol || 0.15);
    if (jump) { flushT(); seg = []; off = null; keptT = null; }
    if (isOff !== off) { flushT(); seg = seg.length ? [seg[seg.length - 1]] : []; off = isOff; keptT = null; }
    if (!near(t, keptT)) { seg.push(X(t.x) + ' ' + Y(t.y)); keptT = t; }
    last = t;
  }
  flushT();
  return opts.withScale ? { o, X: (x) => +X(x), Y: (y) => +Y(y) } : o;
}
function card(x, y, w, h, title, lines, inner) {
  let o = `<g transform="translate(${x},${y})"><rect width="${w}" height="${h}" rx="10" fill="${C.card}" stroke="${C.edge}"/>`;
  o += `<text x="14" y="26" font-size="16" font-weight="600" fill="${C.text}">${esc(title)}</text>`;
  lines.forEach((l, i) => { o += `<text x="14" y="${h - 14 - (lines.length - 1 - i) * 15}" font-size="12" fill="${C.note}">${esc(l)}</text>`; });
  return o + inner + '</g>';
}
function key(x, y, items) {
  let o = '';
  items.forEach(([label, stroke, dash, width], i) => {
    const kx = x + i * 0;
    o += `<g transform="translate(${kx},${y + i * 18})"><line x1="0" y1="-4" x2="22" y2="-4" stroke="${stroke}" stroke-width="${width || 2.6}"${dash ? ` stroke-dasharray="${dash}"` : ''}/><text x="28" y="0" font-size="12" fill="${C.key}">${esc(label)}</text></g>`;
  });
  return o;
}
function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" font-family="${FONT}">${body}</svg>\n`;
}
const prog = (body) => ['G21 G90 G17', 'G0 Z5', ...body, 'G0 Z5', 'M30'].join('\n') + '\n';

// ---- the start of a cut: the blade still points the way the last cut went ----
function startTurn() {
  const R = 6;
  const want = prog(['G0 X0 Y0', 'G1 Z-0.5 F200', 'G1 X40 Y0 F1000', 'G0 Z5',
    'G0 X60 Y20', 'G1 Z-0.5 F200', 'G1 X60 Y60 F1000', 'G1 X100 Y60', 'G1 X100 Y20', 'G1 X60 Y20']);
  const set = { offset: R, leadIn: false, rampLength: 12, liftOut: 0.5 };
  const before = DK.process(want, Object.assign({ startTurn: false }, set)).text;
  const after = DK.process(want, set).text;
  const W = 470, H = 400, box = { x: 10, y: 40, w: W - 20, h: H - 120 };
  let body = card(0, 0, W, H, 'Before: the start drags', ['The second cut starts with the blade still pointing', 'the way the first cut went (to the right): the tip', 'drags off the line until the ramp lines it up.'], drawing(want, before, R, box, { holder: true }));
  body += card(W + 22, 0, W, H, 'Now: turn in place, then ramp', ['The tip lands on the start, the blade turns there', '(shallow), then ramps in already lined up. The first', 'cut of a program can’t know which way it points.'], drawing(want, after, R, box, { holder: true }));
  body += key(14, H + 28, [['the cut you want', C.want, '5 4', 1.5], ['holder (spindle) path; dotted in the air', C.holder, '2 3', 1.2],
    ['what the blade tip cuts', C.tip], ['off the line', C.off]]);
  return svg(2 * W + 22, H + 100, body);
}

// ---- the offset test: a row of tiles, the blade really trailing `real` ----
function offsetTest() {
  const offs = DK.testOffsets(6, 0.6, 5);   // 4.8 ... 7.2: the default 5 tiles
  const t = DK.offsetTest({ offsets: offs, size: 0, depth: 0.5, uncorrected: true }, { offset: 6, rampLength: 12, liftOut: 0.5 });
  // the cut you want: each tile and its ticks, as drawn (the test program before processing)
  const want = prog(t.tiles.flatMap((tl) => {
    const p = DK.testTile(tl.x, tl.y, t.size), L = ['G0 X' + p[0][0] + ' Y' + p[0][1], 'G1 Z-0.5 F200', ...p.slice(1).map((q) => 'G1 X' + q[0].toFixed(3) + ' Y' + q[1].toFixed(3) + ' F1000'), 'G0 Z5'];
    const tickL = t.size * 0.25, y0 = tl.y - tickL - Math.max(t.size * 0.2, Math.max(...offs) + 1);
    for (let i = 0; i < tl.n; i++) {
      const tx = tl.x + t.size * 0.2 + (tl.n === 1 ? t.size * 0.3 : t.size * 0.6 * i / (tl.n - 1));
      L.push('G0 X' + tx.toFixed(3) + ' Y' + y0.toFixed(3), 'G1 Z-0.5 F200', 'G1 X' + tx.toFixed(3) + ' Y' + (y0 + tickL).toFixed(3) + ' F1000', 'G0 Z5');
    }
    return L;
  }));
  const W = 960, H = 330;
  let body = '';
  [[6, 'Your blade really trails 6 mm', 'Tile 3 (6 mm) is sharp: pick it. Tiles 1 and 2 round their corners and point; tiles 4 and 5 loop.', 3],
    [5.4, 'If it really trailed 5.4 mm', 'Now tile 2 (5.4 mm) is the sharp one: the best tile moves with the real offset.', 2]].forEach(([real, title, note, best], row) => {
    const box = { x: 10, y: 34, w: W - 20, h: H - 100 };
    const dr = drawing(want, t.text, real, box, { tol: 0.15, withScale: true });
    let inner = dr.o;
    // tile labels under the drawing
    const yLab = Math.max(...t.tiles.map(() => 0)) + box.y + box.h + 12;
    t.tiles.forEach((tl) => {
      const cx = dr.X(tl.x + t.size / 2);
      const label = tl.n === 0 ? 'tile 0: uncorrected' : 'tile ' + tl.n + ': ' + tl.offset + ' mm' + (tl.n === best ? ' (best)' : '');
      inner += `<text x="${cx.toFixed(1)}" y="${yLab}" font-size="12" text-anchor="middle" fill="${tl.n === best ? C.tip : C.key}"${tl.n === best ? ' font-weight="600"' : ''}>${esc(label)}</text>`;
    });
    body += card(0, row * (H + 20), W, H, title, [note], inner);
  });
  body += key(14, 2 * (H + 20) + 14, [['the cut you want', C.want, '5 4', 1.5], ['what the blade tip cuts', C.tip], ['off the line: rounded, barbed or looped', C.off]]);
  return svg(W, 2 * (H + 20) + 64, body);
}

const out = path.join(__dirname, '..', 'docs', 'images');
fs.writeFileSync(path.join(out, 'start-turn.svg'), startTurn());
fs.writeFileSync(path.join(out, 'offset-test.svg'), offsetTest());
console.log('wrote docs/images/start-turn.svg, docs/images/offset-test.svg');
