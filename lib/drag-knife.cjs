// Drag knife post-processor: rewrites a program written for the blade TIP into
// the path the spindle AXIS must follow, given the blade's offset (the tip
// trails the axis by `offset`). Pure functions; no DOM, no fetch.
//
// The rule: at tip point P travelling in unit direction t, the axis is at
// A = P + offset * t. So lines shift forward by `offset`, arcs stay arcs on the
// same centre (radius sqrt(R^2 + offset^2)), and at a corner the axis swings an
// arc of radius `offset` around the corner point (the "swivel"), turning the
// blade in place. Cuts ramp in along the path so the blade lines up while it is
// shallow; closed shapes recut their start and lift out moving forward.
//
// Used by config.html (copied in between BEGIN/END markers) and by the tests.
var DragKnife = (function () {
  'use strict';

  var VERSION_TAG = 'dragknife';
  var DEFAULTS = {
    offset: 0.25,        // mm, blade tip behind the axis
    swivelAngle: 10,     // degrees; turns sharper than this get a swivel arc
    surfaceZ: 0,         // program units; Z below this is in the material
    rampLength: 2,       // mm; cuts start at the surface and reach depth over this
    liftOut: 0.5,        // mm; closed shapes lift out over this, moving forward
    liftAngle: 0,        // degrees; 0 = off. Turns sharper than this lift during the swivel
    liftFraction: 0.5,   // how far up toward the surface the blade lifts (0..1)
    liftRamp: 1,         // mm; after a lifted swivel, back to depth over this
    stripSpindle: true,  // remove spindle starts (M3/M4) and speeds (S): a knife must never spin
    leadInAngle: 0,      // degrees; 0 = off. Turns sharper than this hop up and lead back in along the next line
    leadInLength: 1.5,   // mm; the lead-in starts this far behind the corner, on the next line extended
    hopHeight: 1,        // mm above the material top while hopping to the lead-in
    protect: 'inside'    // which side of a closed shape the lead-in cuts must not touch: 'inside', 'outside', 'none'
  };
  var PROTECT = ['inside', 'outside', 'none'];

  // ---------- vectors ----------
  function v(x, y) { return { x: x, y: y }; }
  function sub(a, b) { return v(a.x - b.x, a.y - b.y); }
  function add(a, b) { return v(a.x + b.x, a.y + b.y); }
  function mul(a, k) { return v(a.x * k, a.y * k); }
  function len(a) { return Math.hypot(a.x, a.y); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function cross(a, b) { return a.x * b.y - a.y * b.x; }
  function dot(a, b) { return a.x * b.x + a.y * b.y; }
  function turn(a, b) { return Math.atan2(cross(a, b), dot(a, b)); } // signed radians, + = left

  // ---------- parsing ----------
  var WORD = /([A-Za-z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;
  function parseLine(raw) {
    var comment = '';
    var code = raw.replace(/\([^)]*\)/g, function (m) { comment += m; return ' '; });
    var sc = code.indexOf(';');
    if (sc >= 0) { comment += code.slice(sc); code = code.slice(0, sc); }
    code = code.trim();
    var words = [], m;
    WORD.lastIndex = 0;
    while ((m = WORD.exec(code))) words.push({ l: m[1].toUpperCase(), v: parseFloat(m[2]) });
    var special = /^[$%]/.test(code);
    return { code: code, comment: comment, words: words, special: special };
  }

  // ---------- elements ----------
  // A path element is a line or arc in XY with Z at each end:
  // { kind: 'line'|'arc', from, to, z0, z1, f, mode, c (arc centre), sweep (arc, signed radians), preZ: [] }
  function arcRadius(e) { return dist(e.from, e.c); }
  function elemLen(e) {
    if (e.kind === 'line') return dist(e.from, e.to);
    return Math.abs(e.sweep) * arcRadius(e);
  }
  function tangentAt(e, frac) {
    if (e.kind === 'line') { var d = sub(e.to, e.from), l = len(d); return mul(d, 1 / l); }
    var a0 = Math.atan2(e.from.y - e.c.y, e.from.x - e.c.x), a = a0 + e.sweep * frac;
    return e.sweep > 0 ? v(-Math.sin(a), Math.cos(a)) : v(Math.sin(a), -Math.cos(a));
  }
  function pointAt(e, frac) {
    if (e.kind === 'line') return add(e.from, mul(sub(e.to, e.from), frac));
    var r = arcRadius(e), a = Math.atan2(e.from.y - e.c.y, e.from.x - e.c.x) + e.sweep * frac;
    return v(e.c.x + r * Math.cos(a), e.c.y + r * Math.sin(a));
  }
  function clone(e) {
    return { kind: e.kind, from: e.from, to: e.to, z0: e.z0, z1: e.z1, f: e.f, mode: e.mode, c: e.c, sweep: e.sweep, preZ: (e.preZ || []).slice(), src: e.src };
  }
  // Split e at path length s into two elements.
  function splitAt(e, s) {
    var L = elemLen(e), k = s / L, p = pointAt(e, k), zm = e.z0 + (e.z1 - e.z0) * k;
    var a = clone(e), b = clone(e);
    a.to = p; a.z1 = zm; b.from = p; b.z0 = zm; b.preZ = [];
    if (e.kind === 'arc') { a.sweep = e.sweep * k; b.sweep = e.sweep * (1 - k); }
    return [a, b];
  }
  // The first `L` of the path, copied (no vertical moves).
  function prefix(elems, L) {
    var out = [], s = 0;
    for (var i = 0; i < elems.length && s < L - 1e-9; i++) {
      var e = clone(elems[i]), el = elemLen(e);
      e.preZ = [];
      if (s + el > L + 1e-9) e = splitAt(e, L - s)[0];
      out.push(e);
      s += elemLen(e);
    }
    return out;
  }
  // From element index i on, over path length L, blend Z from `fromZ` back to
  // the element's own Z. Splits the element where the ramp ends.
  function applyRamp(elems, i, fromZ, L) {
    if (!(L > 0)) return;
    var s = 0;
    for (; i < elems.length && s < L - 1e-9; i++) {
      var e = elems[i], el = elemLen(e);
      if (s + el > L + 1e-9) {
        var parts = splitAt(e, L - s);
        elems.splice(i, 1, parts[0], parts[1]);
        e = parts[0]; el = L - s;
      }
      var f0 = Math.min(1, s / L), f1 = Math.min(1, (s + el) / L);
      e.z0 = fromZ + (e.z0 - fromZ) * f0;
      e.z1 = fromZ + (e.z1 - fromZ) * f1;
      s += el;
    }
  }

  // ---------- output ----------
  function fmt(n) {
    var s = (Math.abs(n) < 5e-5 ? 0 : n).toFixed(4);
    s = s.replace(/\.?0+$/, '');
    return s === '-0' ? '0' : s;
  }

  // ---------- the program ----------
  function readSettings(raw) {
    var s = {};
    for (var k in DEFAULTS) {
      if (typeof DEFAULTS[k] === 'boolean') { s[k] = raw && typeof raw[k] === 'boolean' ? raw[k] : DEFAULTS[k]; continue; }
      if (k === 'protect') { s[k] = raw && PROTECT.indexOf(raw[k]) >= 0 ? raw[k] : DEFAULTS[k]; continue; }
      var n = raw && raw[k] !== undefined && raw[k] !== '' ? Number(raw[k]) : DEFAULTS[k];
      s[k] = isFinite(n) ? n : DEFAULTS[k];
    }
    if (s.offset < 0) s.offset = 0;
    s.liftFraction = Math.max(0, Math.min(1, s.liftFraction));
    return s;
  }

  // Remove M3/M4 and S words from a line, keeping the rest and saying what went.
  // Returns null when there's nothing to remove. M5 (spindle off) stays.
  function stripSpindleWords(raw) {
    var p = parseLine(raw);
    if (p.special || !p.words.some(function (w) { return (w.l === 'M' && (w.v === 3 || w.v === 4)) || w.l === 'S'; })) return null;
    var removed = [];
    var code = p.code.replace(/M\s*0*[34](?![\d.])|S\s*[-+]?(?:\d+\.?\d*|\.\d+)/gi, function (m) { removed.push(m.replace(/\s+/g, '').toUpperCase()); return ' '; });
    code = code.replace(/\s+/g, ' ').trim();
    var note = '(dk: removed ' + removed.join(' ') + ')';
    return (code ? code + ' ' : '') + note + (p.comment ? ' ' + p.comment : '');
  }

  function isProcessed(text) { return /\(\s*dragknife\b[^)]*processed/i.test(text); }

  // process(text, settings) -> { text, stats }   (throws Error('Line n: ...') on what it won't rewrite)
  function process(text, rawSettings, meta) {
    var cfg = readSettings(rawSettings);
    if (isProcessed(text)) throw new Error('This program has already been processed for the drag knife. Load the original file instead.');
    var lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    var st = { mm: true, abs: true, arcAbs: false, plane: 17, comp: 40, motion: 0, f: null, pos: { x: null, y: null, z: null } };
    var out = [];
    var stats = { strokes: 0, rewritten: 0, closed: 0, swivels: 0, lifted: 0, leadIns: 0, tightArcs: 0, spindleRemoved: 0, units: null };
    var stroke = null;
    var surface = cfg.surfaceZ;

    function cutting(z) { return z !== null && z < surface - 1e-9; }
    function fail(n, msg) { throw new Error('Line ' + (n + 1) + ': ' + msg); }

    function flush() {
      if (!stroke) return;
      stats.strokes++;
      var res = rewriteStroke(stroke, st, cfg, stats);
      for (var i = 0; i < res.length; i++) out.push(res[i]);
      stroke = null;
    }

    for (var n = 0; n < lines.length; n++) {
      var raw = lines[n];
      if (cfg.stripSpindle) {
        var stripped = stripSpindleWords(raw);
        if (stripped !== null) { raw = stripped; stats.spindleRemoved++; }
      }
      var p = parseLine(raw);
      if (p.special) { if (stroke) fail(n, '"' + p.code + '" in the middle of a cut.'); out.push(raw); continue; }
      var g = [], other = {}, axes = {}, hasAxis = false;
      for (var w = 0; w < p.words.length; w++) {
        var wd = p.words[w];
        if (wd.l === 'G') g.push(Math.round(wd.v * 10) / 10);
        else if ('XYZIJKR'.indexOf(wd.l) >= 0) { axes[wd.l] = wd.v; if ('XYZ'.indexOf(wd.l) >= 0) hasAxis = true; }
        else if (wd.l === 'N') { /* line number */ }
        else other[wd.l] = wd.v;
      }
      var motion = null, nonMotionAxes = false, machine = false;
      for (var gi = 0; gi < g.length; gi++) {
        var c = g[gi];
        if (c === 0 || c === 1 || c === 2 || c === 3) motion = c;
        else if (c === 17 || c === 18 || c === 19) st.plane = c;
        else if (c === 20) st.mm = false;
        else if (c === 21) st.mm = true;
        else if (c === 90) st.abs = true;
        else if (c === 91) st.abs = false;
        else if (c === 90.1) st.arcAbs = true;
        else if (c === 91.1) st.arcAbs = false;
        else if (c === 40 || c === 41 || c === 42) st.comp = c;
        else if (c === 53) machine = true;
        else if (c === 10 || c === 28 || c === 30 || c === 92 || c === 4 || c === 28.1 || c === 30.1 || c === 92.1) nonMotionAxes = true;
        else if (c >= 80 && c < 90) { if (c !== 80) fail(n, 'canned cycles (G' + c + ') aren\'t supported.'); }
        else if (c === 38.2 || c === 38.3 || c === 38.4 || c === 38.5) machine = true;
      }
      if (other.F !== undefined) st.f = other.F;
      var isMotion = !nonMotionAxes && (motion !== null ? true : hasAxis);
      if (motion !== null) st.motion = motion;

      if (!isMotion || (motion !== null && !hasAxis && !(st.motion >= 2 && (axes.I !== undefined || axes.J !== undefined)))) {
        // Not a move (or a bare modal G word).
        if (stroke) {
          var onlyFeed = Object.keys(other).every(function (k) { return k === 'F'; }) && g.every(function (c) { return c === 0 || c === 1 || c === 2 || c === 3; });
          if (!onlyFeed) fail(n, '"' + p.code + '" in the middle of a cut.');
          if (p.comment) stroke.comments.push(p.comment);
          stroke.rawAll.push(raw);
          continue;
        }
        if (nonMotionAxes || machine) {
          // Coordinates change or the head moves in other coordinates: position unknown.
          if (axes.X !== undefined) st.pos.x = null;
          if (axes.Y !== undefined) st.pos.y = null;
          if (axes.Z !== undefined || g.indexOf(28) >= 0 || g.indexOf(30) >= 0) st.pos.z = null;
        }
        out.push(raw);
        continue;
      }
      if (machine) {
        if (stroke) fail(n, 'G53 / probing in the middle of a cut.');
        if (axes.X !== undefined) st.pos.x = null;
        if (axes.Y !== undefined) st.pos.y = null;
        if (axes.Z !== undefined) st.pos.z = null;
        out.push(raw);
        continue;
      }
      var from = { x: st.pos.x, y: st.pos.y, z: st.pos.z };
      var to = {
        x: axes.X === undefined ? from.x : (st.abs ? axes.X : (from.x === null ? null : from.x + axes.X)),
        y: axes.Y === undefined ? from.y : (st.abs ? axes.Y : (from.y === null ? null : from.y + axes.Y)),
        z: axes.Z === undefined ? from.z : (st.abs ? axes.Z : (from.z === null ? null : from.z + axes.Z))
      };
      var inCut = cutting(from.z) || cutting(to.z);
      if (inCut) {
        if (!st.abs) fail(n, 'incremental moves (G91) while cutting aren\'t supported.');
        if (st.comp !== 40) fail(n, 'cutter compensation (G41/G42) isn\'t supported.');
        if (st.motion >= 2 && st.plane !== 17) fail(n, 'arcs outside the XY plane (G18/G19) aren\'t supported.');
        if (from.x === null || from.y === null || to.x === null || to.y === null) fail(n, 'the X/Y position isn\'t known here (no X/Y move before the cut).');
        if (stats.units === null) stats.units = st.mm ? 'mm' : 'in';
        if (!stroke) {
          if (from.z === null) fail(n, 'the Z height before this cut isn\'t known (no Z move earlier).');
          stroke = { recs: [], comments: [], rawAll: [], start: from, mm: st.mm, arcAbs: st.arcAbs, firstLine: n };
        }
        if (stroke.mm !== st.mm) fail(n, 'units change in the middle of a cut.');
        var rec = { n: n, raw: raw, mode: st.motion, from: from, to: to, f: st.f };
        if (st.motion >= 2) {
          var c0;
          if (axes.R !== undefined) {
            c0 = centerFromR(from, to, axes.R, st.motion === 2);
            if (!c0) fail(n, 'the arc radius R is too small for its end points.');
          } else {
            var I = axes.I || 0, J = axes.J || 0;
            c0 = st.arcAbs ? v(axes.I === undefined ? from.x : I, axes.J === undefined ? from.y : J) : v(from.x + I, from.y + J);
          }
          rec.c = c0;
        }
        stroke.recs.push(rec);
        stroke.rawAll.push(raw);
        st.pos = to;
        if (!cutting(to.z)) flush();
      } else {
        flush();
        out.push(raw);
        st.pos = to;
      }
    }
    if (stroke) flush();
    if (stats.rewritten === 0) {
      return { text: text, stats: stats, changed: false };
    }
    var u = stats.units === 'in' ? 'in' : 'mm';
    var header = '(' + VERSION_TAG + ' processed: offset ' + fmt(cfg.offset) + 'mm, swivel above ' + fmt(cfg.swivelAngle) +
      'deg, ramp ' + fmt(cfg.rampLength) + 'mm, lift ' + (cfg.liftAngle > 0 ? 'above ' + fmt(cfg.liftAngle) + 'deg' : 'off') +
      ', lead-in ' + (cfg.leadInAngle > 0 ? 'above ' + fmt(cfg.leadInAngle) + 'deg, ' + fmt(cfg.leadInLength) + 'mm, protect ' + cfg.protect : 'off') +
      ', spindle ' + (cfg.stripSpindle ? 'removed' : 'kept') +
      (meta && meta.source ? ', from ' + String(meta.source).replace(/[()]/g, '') : '') + ', program in ' + u + ')';
    var at = out.length && /^\s*%/.test(out[0]) ? 1 : 0;
    out.splice(at, 0, header);
    return { text: out.join('\n') + '\n', stats: stats, changed: true };
  }

  function centerFromR(from, to, R, cw) {
    var d = dist(from, to), r = Math.abs(R);
    if (d < 1e-9 || d > 2 * r + 1e-6) return null;
    var h = Math.sqrt(Math.max(0, r * r - d * d / 4));
    var mid = v((from.x + to.x) / 2, (from.y + to.y) / 2);
    var u = mul(sub(to, from), 1 / d), left = v(-u.y, u.x);
    // CCW with positive R: centre on the left; CW: on the right. Negative R: the long way.
    var side = (cw ? -1 : 1) * (R < 0 ? -1 : 1);
    return add(mid, mul(left, side * h));
  }

  function sweepOf(from, to, c, ccw) {
    var a0 = Math.atan2(from.y - c.y, from.x - c.x), a1 = Math.atan2(to.y - c.y, to.x - c.x);
    var s = a1 - a0, full = dist(from, to) < 1e-7;
    if (ccw) { while (s <= 1e-12) s += 2 * Math.PI; if (full) s = 2 * Math.PI; }
    else { while (s >= -1e-12) s -= 2 * Math.PI; if (full) s = -2 * Math.PI; }
    return s;
  }

  // One cut: from the move that goes into the material to the one that leaves it.
  function rewriteStroke(stroke, st, cfg, stats) {
    var recs = stroke.recs, scale = stroke.mm ? 1 : 1 / 25.4;
    var r = cfg.offset * scale, tol = 0.005 * scale, surface = cfg.surfaceZ;
    var verbatim = stroke.rawAll;

    // Split: vertical moves before the first XY move, the XY path, verticals after.
    function vertical(rc) { return rc.mode < 2 && dist(rc.from, rc.to) < 1e-9; }
    var a = 0, b = recs.length - 1;
    while (a <= b && vertical(recs[a])) a++;
    while (b >= a && vertical(recs[b])) b--;
    if (a > b || r <= 0) return verbatim; // a poke or no offset: nothing to do
    var lead = recs.slice(0, a), trail = recs.slice(b + 1), elems = [], pending = [];
    for (var i = a; i <= b; i++) {
      var rc = recs[i];
      if (vertical(rc)) { pending.push(rc); continue; }
      var e = { from: v(rc.from.x, rc.from.y), to: v(rc.to.x, rc.to.y), z0: rc.from.z, z1: rc.to.z, f: rc.f, mode: rc.mode, preZ: pending, src: rc.n };
      pending = [];
      if (rc.mode >= 2) {
        e.kind = 'arc'; e.c = rc.c; e.sweep = sweepOf(e.from, e.to, rc.c, rc.mode === 3);
        if (Math.abs(dist(e.from, e.c) - dist(e.to, e.c)) > 0.002 * Math.max(1, dist(e.from, e.c)) + tol) {
          throw new Error('Line ' + (rc.n + 1) + ': the arc\'s end isn\'t on its circle.');
        }
        if (dist(e.from, e.c) < r) stats.tightArcs++;
      } else e.kind = 'line';
      if (elemLen(e) < 1e-9) { if (e.preZ.length) pending = e.preZ; continue; }
      elems.push(e);
    }
    if (!elems.length) return verbatim;
    // Verticals between the last XY move and the trailing ones stay with the trail.
    if (pending.length) trail = pending.concat(trail);

    var closed = dist(elems[0].from, elems[elems.length - 1].to) < tol && elems.length > 0;
    // Which way round a closed shape goes: +1 anticlockwise (inside on the left), -1 clockwise.
    var orient = 0;
    if (closed) {
      var area = 0;
      elems.forEach(function (e) {
        var pts = e.kind === 'arc' ? [e.from, pointAt(e, 0.25), pointAt(e, 0.5), pointAt(e, 0.75)] : [e.from];
        pts.push(e.to);
        for (var q = 1; q < pts.length; q++) area += cross(pts[q - 1], pts[q]);
      });
      orient = area > 0 ? 1 : area < 0 ? -1 : 0;
    }
    var swRad = cfg.swivelAngle * Math.PI / 180, leadRad = cfg.leadInAngle * Math.PI / 180;
    // How to get round the corner between a and b: 'link' (let it drag), 'swivel' or 'lead'.
    // A lead-in cuts along b's line extended behind the corner. At a left turn that
    // extension is on the right of the path; at a right turn, on the left. So it's
    // outside an anticlockwise shape at a left turn, inside it at a right turn.
    function cornerKind(a, b) {
      var tr = turn(tangentAt(a, 1), tangentAt(b, 0));
      if (Math.abs(tr) <= swRad) return 'link';
      if (cfg.leadInAngle > 0 && Math.abs(tr) > leadRad && b.z0 < surface) {
        if (cfg.protect === 'none') return 'lead';
        if (orient !== 0) {
          var extOutside = (tr > 0) === (orient > 0);
          if ((cfg.protect === 'inside') === extOutside) return 'lead';
        }
      }
      return 'swivel';
    }
    if (closed) {
      stats.closed++;
      // Recut the start at the depth the shape finished at.
      var zFinal = elems[elems.length - 1].z1;
      var overlap = prefix(elems, cfg.rampLength * scale + r);
      overlap.forEach(function (o) { o.z0 = zFinal; o.z1 = zFinal; });
      elems = elems.concat(overlap);
    }
    // Lifted swivels at sharp corners (back to front so indices hold).
    if (cfg.liftAngle > 0) {
      for (var j = elems.length - 1; j > 0; j--) {
        var ang = Math.abs(turn(tangentAt(elems[j - 1], 1), tangentAt(elems[j], 0))) * 180 / Math.PI;
        if (ang > cfg.liftAngle && cornerKind(elems[j - 1], elems[j]) === 'swivel') {
          var zEnd = elems[j - 1].z1;
          if (zEnd < surface) {
            stats.lifted++;
            applyRamp(elems, j, zEnd + (surface - zEnd) * cfg.liftFraction, cfg.liftRamp * scale);
          }
        }
      }
    }
    // Ramp in from the surface, replacing the plunge below the surface.
    var rampIn = cfg.rampLength > 0 && elems[0].z0 < surface;
    if (rampIn) applyRamp(elems, 0, surface, cfg.rampLength * scale);

    var outL = [];
    var mode = null, feed = null;
    function arcWords(I, J) { return st.arcAbs || stroke.arcAbs ? ' I' + fmt(I.x) + ' J' + fmt(I.y) : ' I' + fmt(I.x - J.x) + ' J' + fmt(I.y - J.y); }
    function emit(m, xy, z, f, extra) {
      var s = 'G' + m;
      if (xy) s += ' X' + fmt(xy.x) + ' Y' + fmt(xy.y);
      if (z !== null && z !== undefined) s += ' Z' + fmt(z);
      if (extra) s += extra;
      if (m !== 0 && f !== null && f !== undefined && f !== feed) { s += ' F' + fmt(f); feed = f; }
      mode = m;
      outL.push(s);
    }

    stats.rewritten++;
    outL.push('(dk: cut ' + stats.rewritten + ', ' + (closed ? 'closed' : 'open') + ', from line ' + (stroke.firstLine + 1) + ')');
    for (var ci = 0; ci < stroke.comments.length; ci++) outL.push(stroke.comments[ci]);

    var t0 = tangentAt(elems[0], 0);
    var axis = add(elems[0].from, mul(t0, r));
    var zNow = stroke.start.z;
    // Move over: the axis starts `offset` ahead of the tip's start point. A rapid
    // above the work; a feed move when the blade is already down on the surface.
    if (zNow > surface + 1e-9) emit(0, axis, null, null);
    else emit(1, axis, null, elems[0].f);
    for (var li = 0; li < lead.length; li++) {
      var lz = lead[li].to.z;
      if (rampIn && lz < surface) lz = surface;
      if (Math.abs(lz - zNow) < 1e-9) continue;
      emit(lead[li].mode < 2 ? lead[li].mode : 1, null, lz, lead[li].f);
      zNow = lz;
    }
    if (!rampIn && Math.abs(elems[0].z0 - zNow) > 1e-9) { emit(1, null, elems[0].z0, elems[0].f); zNow = elems[0].z0; }
    var plungeF = null;
    for (var lf = 0; lf < lead.length; lf++) if (lead[lf].to.z < surface) plungeF = lead[lf].f;
    var hopZ = surface + Math.max(0, cfg.hopHeight) * scale;
    for (var k = 0; k < elems.length; k++) {
      var el = elems[k];
      var dS = tangentAt(el, 0), start = add(el.from, mul(dS, r));
      if (k > 0) {
        var dE = tangentAt(elems[k - 1], 1), tr = turn(dE, dS), kind = cornerKind(elems[k - 1], el);
        if (kind === 'lead') {
          // Hop up, go back along this line extended behind the corner, and cut
          // into the corner from there, reaching depth at the corner: the blade
          // is lined up before the cut proper begins.
          var leadStart = add(sub(el.from, mul(dS, cfg.leadInLength * scale)), mul(dS, r));
          stats.leadIns++;
          emit(0, null, hopZ, null);
          emit(0, leadStart, null, null);
          emit(1, null, surface, plungeF !== null ? plungeF : el.f);
          emit(1, start, el.z0, el.f);
        } else if (kind === 'swivel') {
          // Swivel: the axis swings around the tip at the corner.
          var C = el.from, ccw = tr > 0 || Math.abs(Math.abs(tr) - Math.PI) < 1e-6;
          stats.swivels++;
          emit(ccw ? 3 : 2, start, Math.abs(el.z0 - zNow) > 1e-9 ? el.z0 : null, el.f, arcWords(C, axis));
        } else if (dist(axis, start) > 1e-7 || Math.abs(el.z0 - zNow) > 1e-9) {
          emit(1, start, Math.abs(el.z0 - zNow) > 1e-9 ? el.z0 : null, el.f);
        }
        axis = start; zNow = el.z0;
      }
      for (var pz = 0; pz < el.preZ.length; pz++) {
        var pr = el.preZ[pz];
        if (Math.abs(pr.to.z - zNow) < 1e-9) continue;
        emit(pr.mode < 2 ? pr.mode : 1, null, pr.to.z, pr.f); zNow = pr.to.z;
      }
      var dEnd = tangentAt(el, 1), end = add(el.to, mul(dEnd, r));
      var zw = Math.abs(el.z1 - zNow) > 1e-9 ? el.z1 : null;
      if (el.kind === 'line') emit(el.mode === 0 ? 0 : 1, end, zw, el.f);
      else emit(el.sweep > 0 ? 3 : 2, end, zw, el.f, arcWords(el.c, axis));
      axis = end; zNow = el.z1;
    }
    // Closed shapes: lift out while still moving forward, over recut ground.
    if (closed && cfg.liftOut > 0 && zNow < surface) {
      var dOut = tangentAt(elems[elems.length - 1], 1);
      emit(1, add(axis, mul(dOut, cfg.liftOut * scale)), surface, elems[elems.length - 1].f);
      zNow = surface;
    }
    for (var ti = 0; ti < trail.length; ti++) {
      var tz = trail[ti].to.z;
      if (Math.abs(tz - zNow) < 1e-9) continue;
      emit(trail[ti].mode < 2 ? trail[ti].mode : 1, null, tz, trail[ti].f);
      zNow = tz;
    }
    // Leave the modal state (motion mode, feed) as the original would have.
    var restore = '';
    if (mode !== st.motion) restore += 'G' + st.motion;
    if (st.f !== null && feed !== st.f) restore += (restore ? ' ' : '') + 'F' + fmt(st.f);
    if (restore) outL.push(restore);
    return outL;
  }

  return {
    DEFAULTS: DEFAULTS, process: process, readSettings: readSettings, isProcessed: isProcessed,
    parseLine: parseLine, stripSpindleWords: stripSpindleWords, _internal: { turn: turn, tangentAt: tangentAt, elemLen: elemLen, splitAt: splitAt, sweepOf: sweepOf, centerFromR: centerFromR }
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = DragKnife;
