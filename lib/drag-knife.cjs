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
    offset: 6,           // mm, blade tip behind the axis (large-format CNC drag knives; vinyl-cutter blades are 0.25-0.5)
    swivelAngle: 10,     // degrees; turns sharper than this get a swivel arc
    zZero: 'auto',       // where the program's Z0 is: 'auto' (from its comments, else its heights), 'top' of the material, 'bottom' (the bed), 'other' (surfaceZ)
    thickness: 0,        // mm; the material's thickness, for Z0 on the bed (the top is then at Z = thickness)
    surfaceZ: 0,         // program units; with zZero 'other': Z below this is in the material
    rampLength: 12,      // mm; cuts start at the surface and reach depth over this (about 2 offsets: the blade lines up)
    liftOut: 0.5,        // mm; closed shapes lift out over this, moving forward
    liftAngle: 0,        // degrees; 0 = off. Turns sharper than this lift during the swivel
    liftFraction: 0.5,   // how far up toward the surface the blade lifts (0..1)
    liftRamp: 1,         // mm; after a lifted swivel, back to depth over this
    stripSpindle: true,  // remove spindle starts (M3/M4) and speeds (S): a knife must never spin
    leadIn: true,        // lead into sharp corners (below) instead of swivelling
    leadInAngle: 60,     // degrees; turns sharper than this hop up and lead back in along the next line
    leadInLength: 18,    // mm; the lead-in starts this far behind the corner, on the next line extended (about 3 offsets)
    hopHeight: 1,        // mm above the material top while hopping to the lead-in
    startTurn: true,     // turn the blade in place where a cut (or a lead-in) starts, from the way it last pointed
    turnDepth: 0.25,     // how deep it turns, as a fraction of the cut's depth (0..1)
    lineUp: true,        // before the program's first cut (the blade's heading unknown), drag a short line in the waste to line it up
    saveToFileManager: false,   // the dialog: also save results (and temporary originals) to File Manager › Drag Knife
    // the offset test (the dialog): step 0 = 15 % of the offset, size 0 = from the offsets
    testStep: 0, testCount: 5, testSize: 0, testDepth: 0.3, testFeed: 1000, testUncorrected: true,
    lastTest: '',        // the offsets of the last test loaded, "4.2,5.1,6", for picking the best tile
    knives: [],          // saved knives: [{ name, s: { the KNIFE_KEYS settings } }], picked from the Blade menu
    protect: 'auto'      // which side of a closed shape lead-in cuts must not touch: 'auto' (parts' inside, holes' outside), 'inside', 'outside', 'none'
  };
  var PROTECT = ['auto', 'inside', 'outside', 'none'];
  var ZZERO = ['auto', 'top', 'bottom', 'other'];
  // What a saved knife holds: the blade and how it moves. Not the material top, the
  // spindle switch, the side to protect or the offset test's fields.
  var KNIFE_KEYS = ['offset', 'swivelAngle', 'rampLength', 'liftOut', 'startTurn', 'turnDepth', 'lineUp', 'leadIn', 'leadInAngle',
    'leadInLength', 'hopHeight', 'liftAngle', 'liftFraction', 'liftRamp'];
  // Saved knives, cleaned: at most 20, each with a name (1 to 40 plain characters,
  // unique) and its settings read like any others.
  function readKnives(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (kn) {
      if (out.length >= 20 || !kn || typeof kn !== 'object') return;
      var name = String(kn.name || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!name || seen[name.toLowerCase()]) return;
      seen[name.toLowerCase()] = true;
      var all = readSettings(kn.s && typeof kn.s === 'object' ? kn.s : {}), s = {};
      KNIFE_KEYS.forEach(function (k) { s[k] = all[k]; });
      out.push({ name: name, s: s });
    });
    return out;
  }

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
  // The path from length L0 to L1 (clones, split where needed).
  function slicePath(elems, L0, L1) {
    var out = prefix(elems, L1), s = 0;
    while (out.length && s + elemLen(out[0]) <= L0 + 1e-9) { s += elemLen(out[0]); out.shift(); }
    if (out.length && L0 - s > 1e-9) out[0] = splitAt(out[0], L0 - s)[1];
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
      if (k === 'knives') { s[k] = readKnives(raw && raw[k]); continue; }
      if (k === 'lastTest') { s[k] = raw && typeof raw[k] === 'string' && /^[\d.,]*$/.test(raw[k]) ? raw[k] : ''; continue; }
      if (k === 'zZero') { s[k] = raw && ZZERO.indexOf(raw[k]) >= 0 ? raw[k] : DEFAULTS[k]; continue; }
      if (k === 'protect') { s[k] = raw && PROTECT.indexOf(raw[k]) >= 0 ? raw[k] : DEFAULTS[k]; continue; }
      var n = raw && raw[k] !== undefined && raw[k] !== '' ? Number(raw[k]) : DEFAULTS[k];
      s[k] = isFinite(n) ? n : DEFAULTS[k];
    }
    if (s.offset < 0) s.offset = 0;
    // Before the switch, lead-ins were off by a 0 angle: saved settings from then
    // (no leadIn key, angle 0) get the default switch and angle.
    // The switch turns lead-ins on and off; the angle is only "above how sharp". A 0
    // angle (how lead-ins were turned off before the switch, or a cleared field) gets
    // the default, so lead-ins switched on always happen.
    if (!(s.leadInAngle > 0)) s.leadInAngle = DEFAULTS.leadInAngle;
    s.liftFraction = Math.max(0, Math.min(1, s.liftFraction));
    s.turnDepth = Math.max(0, Math.min(1, s.turnDepth));
    if (!(s.thickness >= 0)) s.thickness = 0;
    // settings from before the Z0 choice: a material top other than 0 was typed, so keep it
    if (raw && raw.zZero === undefined && Number(raw.surfaceZ)) s.zZero = 'other';
    s.testCount = Math.max(2, Math.min(9, Math.round(s.testCount)));
    if (!(s.testDepth > 0)) s.testDepth = DEFAULTS.testDepth;
    if (!(s.testFeed > 0)) s.testFeed = DEFAULTS.testFeed;
    if (!(s.testStep >= 0)) s.testStep = 0;
    if (!(s.testSize >= 0)) s.testSize = 0;
    return s;
  }

  // Remove M3/M4 and S words from a line, keeping the rest and saying what went.
  // Returns null when there's nothing to remove. M5 (spindle off) stays.
  // Every line we write stays short and plain so Grbl, grblHAL and FluidNC all take
  // it: at most 79 characters (Grbl's line buffer; grblHAL and FluidNC keep comments
  // in theirs), printable ASCII only, and no '!', '?' or '~', which the controllers
  // can act on as realtime commands even inside a comment.
  var LINE_MAX = 79;
  function commentText(s, max) {
    s = String(s).replace(/[^\x20-\x7e]|[!?~]/g, ' ').replace(/\s+/g, ' ').trim();
    if (max !== undefined && s.length > max) s = max > 3 ? s.slice(0, max - 3).trim() + '...' : '';
    return s;
  }

  function stripSpindleWords(raw) {
    var p = parseLine(raw);
    if (p.special || !p.words.some(function (w) { return (w.l === 'M' && (w.v === 3 || w.v === 4)) || w.l === 'S'; })) return null;
    var removed = [];
    // M3 / M03 / M3.0 and S words (with or without spaces inside the number)
    var code = p.code.replace(/M\s*0*[34](?:\s*\.\s*0*)?(?![\d.])|S\s*[-+]?\s*(?:\d+\.?\d*|\.\d+)/gi, function (m) { removed.push(m.replace(/\s+/g, '').toUpperCase()); return ' '; });
    code = code.replace(/\s+/g, ' ').trim();
    // The original line, commented out, says who removed it. A ';' comment runs to
    // the end of the line, so the original's own comments can stay inside it.
    var head = code ? code + ' ; ' : '; ', tail = code ? '(Drag Knife removed ' + commentText(removed.join(' ')) + ')' : '(removed by Drag Knife)';
    // Within LINE_MAX: the quote shortens first, then the note, then only the code is left.
    if (head.length + tail.length > LINE_MAX) tail = '(Drag Knife)';
    if (head.length + tail.length > LINE_MAX) return code;
    var quote = commentText(raw, LINE_MAX - head.length - tail.length - 2);
    return head + (quote ? quote + '  ' : '') + tail;
  }

  // "(dragknife a, b, c)" lines, each within LINE_MAX.
  function headerLines(parts) {
    var lines = [], cur = '';
    parts.forEach(function (part) {
      if (cur && ('(' + VERSION_TAG + ' ' + cur + ', ' + part + ')').length > LINE_MAX) { lines.push(cur); cur = ''; }
      cur = cur ? cur + ', ' + part : part;
    });
    if (cur) lines.push(cur);
    return lines.map(function (l) { return '(' + VERSION_TAG + ' ' + l + ')'; });
  }

  // The source a result names in its header ("from ..."), or null.
  function processedFrom(text) { var m = /\(dragknife [^)]*\bfrom ([^,)]*)/i.exec(text); return m ? m[1].trim() : null; }
  function isOffsetTest(text) { return /\(\s*dragknife processed: offset test/i.test(text); }
  function isProcessed(text) { return /\(\s*dragknife\b[^)]*processed/i.test(text); }

  // ---------- where the material is ----------
  // readZ(text, settings) -> { mode: 'top'|'bottom'|'other', auto, by: 'set'|'comment'|'heights',
  //   surfaceZ (the material top, program units), units, minZ (the deepest feed move, or null),
  //   depth (mm below the top, or null), bedClearance (mm above the bed, Z0 on the bed), problem }
  // Auto reads a comment naming Z0 (QuickCut's "(Z0: the top of the stock)", "Z0 on the
  // bed" and the like); without one, a program that never feeds below Z0 is taken as Z0
  // on the bed.
  var Z_TOP = /Z0[^)\n]{0,40}?\b(top of (the )?(stock|material|workpiece|part)|(stock|material) top|on top)/i;
  var Z_BED = /Z0[^)\n]{0,40}?\b(bed|table|under the stock|bottom|spoil ?board|waste ?board, under)/i;
  function readZ(text, rawSettings) {
    var cfg = readSettings(rawSettings);
    var lines = String(text).split(/\r?\n/), inch = false, motion = 0, minZ = null, feedAbove = false, cmt = '', zNow = null;
    for (var i = 0; i < lines.length; i++) {
      var p = parseLine(lines[i]);
      if (i < 80) { var m = lines[i].match(/\(([^)]*)\)|;(.*)$/); if (m) cmt += ' ' + (m[1] || m[2] || ''); }
      if (p.special || /G53\b/i.test(p.code)) continue;
      var z = null, xy = false;
      p.words.forEach(function (w) {
        if (w.l === 'G') { var g = Math.round(w.v * 10) / 10; if (g === 20) inch = true; if (g === 21) inch = false; if (g >= 0 && g <= 3 && g === Math.floor(g)) motion = g; }
        if (w.l === 'Z') z = w.v;
        if (w.l === 'X' || w.l === 'Y') xy = true;
      });
      if (z !== null) zNow = z;
      if (z !== null && motion >= 1) minZ = minZ === null ? z : Math.min(minZ, z);
      // cutting moves (feeds across X/Y) that stay above Z0
      if (xy && motion >= 1 && zNow !== null && zNow > 0) feedAbove = true;
    }
    var k = inch ? 1 / 25.4 : 1, mode = cfg.zZero, by = 'set';
    if (mode === 'auto') {
      if (Z_BED.test(cmt) && !Z_TOP.test(cmt)) { mode = 'bottom'; by = 'comment'; }
      else if (Z_TOP.test(cmt)) { mode = 'top'; by = 'comment'; }
      else if (minZ !== null && minZ >= 0 && feedAbove) { mode = 'bottom'; by = 'heights'; }
      else { mode = 'top'; by = 'heights'; }
    }
    var out = { mode: mode, auto: cfg.zZero === 'auto', by: by, units: inch ? 'in' : 'mm', minZ: minZ, surfaceZ: 0, depth: null, bedClearance: null, problem: null };
    if (mode === 'bottom') {
      if (!(cfg.thickness > 0)) out.problem = 'Z0 is on the bed: set Material thickness, so Drag Knife knows where the top of the material is.';
      out.surfaceZ = cfg.thickness * k;
    } else if (mode === 'other') out.surfaceZ = cfg.surfaceZ;
    if (minZ !== null && !out.problem) {
      out.depth = (out.surfaceZ - minZ) / k;
      if (mode === 'bottom') out.bedClearance = minZ / k;
    }
    return out;
  }
  // The settings with surfaceZ where readZ puts the material top.
  function withZ(text, cfg) {
    var z = readZ(text, cfg), c = {};
    for (var key in cfg) c[key] = cfg[key];
    if (z.problem) throw new Error(z.problem);
    c.surfaceZ = z.surfaceZ;
    return c;
  }

  // process(text, settings) -> { text, stats }   (throws Error('Line n: ...') on what it won't rewrite)
  // The settings as the processor reads them: lead-ins switched off = angle 0.
  function active(rawSettings) {
    var cfg = readSettings(rawSettings);
    if (!cfg.leadIn) cfg.leadInAngle = 0;
    return cfg;
  }
  function process(text, rawSettings, meta) {
    var cfg = withZ(text, active(rawSettings));
    if (isProcessed(text)) throw new Error('This program has already been processed for the drag knife. Load the original file instead.');
    var ctx = {}, found = null;
    if ((cfg.protect === 'auto' && cfg.leadInAngle > 0) || (cfg.lineUp && cfg.offset > 0)) {
      // First pass: find the closed shapes, then which are holes (and every path, for
      // a clear place to line the blade up).
      found = analyzeWith(text, cfg, meta);
      if (cfg.protect === 'auto' && cfg.leadInAngle > 0) ctx.holes = found.holes;
      if (cfg.lineUp) ctx.layout = { shapes: found.survey.shapes, paths: found.survey.paths, holes: found.holes };
    }
    var res = processPass(text, cfg, meta, ctx);
    res.stats.autoProblems = found ? found.problems : [];
    return res;
  }

  // What "auto" makes of a program, and whether it can decide.
  // -> { shapes, holes: {n: true}, holeCount, openSharp, overlaps, selfCrossing, problems: [text], suggest }
  // suggest: the manual choice to offer ('none' | 'inside' | 'outside'), or null.
  function analyze(text, rawSettings) {
    var cfg = readSettings(rawSettings);
    try { cfg = withZ(text, cfg); } catch (e) { /* no top known: judge as set */ }
    if (cfg.leadInAngle <= 0) cfg.leadInAngle = 90; // judge the program as if lead-ins were on
    return analyzeWith(text, cfg, null);
  }
  function analyzeWith(text, cfg, meta) {
    var survey = { shapes: [], openSharp: 0, openPaths: 0, paths: [] };
    var c2 = {}; for (var k in cfg) c2[k] = cfg[k];
    c2.protect = 'auto';
    processPass(text, c2, meta, { survey: survey });
    var nest = holesOf(survey.shapes);
    var out = { shapes: survey.shapes.length, holes: nest.holes, holeCount: Object.keys(nest.holes).length,
      openSharp: survey.openSharp, openPaths: survey.openPaths, overlaps: nest.overlaps, selfCrossing: nest.selfCrossing, problems: [], suggest: null, survey: survey };
    if (survey.openSharp > 0) {
      out.problems.push(survey.openPaths + ' open ' + (survey.openPaths === 1 ? 'path has' : 'paths have') + ' ' + survey.openSharp +
        ' sharp ' + (survey.openSharp === 1 ? 'corner' : 'corners') + ' but no inside or outside, so auto swivels ' + (survey.openSharp === 1 ? 'it' : 'them') + '.');
      if (!out.shapes) out.suggest = 'none';
    }
    if (nest.overlaps) out.problems.push(nest.overlaps + ' ' + (nest.overlaps === 1 ? 'shape overlaps' : 'shapes overlap') + ' another, so auto can\'t tell part from hole.');
    if (nest.selfCrossing) out.problems.push(nest.selfCrossing + ' ' + (nest.selfCrossing === 1 ? 'shape crosses' : 'shapes cross') + ' itself, so its inside isn\'t clear.');
    if ((nest.overlaps || nest.selfCrossing) && !out.suggest) out.suggest = 'inside';
    return out;
  }

  // Closed shapes as polygons -> { strokeNumber: true } for each hole: a shape
  // inside an odd number of larger shapes. A same-size shape (the same outline
  // cut again deeper) doesn't count as containing it.
  function holesOf(shapes) {
    function inside(pt, poly) {
      var c = false;
      for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        var a = poly[i], b = poly[j];
        if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) c = !c;
      }
      return c;
    }
    function crosses(poly) {
      var n = poly.length;
      if (n > 3000) return false; // too big to check pair by pair; assume simple
      function hit(a, b, c, d) {
        if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.min(a.x, b.x) > Math.max(c.x, d.x) || Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.min(a.y, b.y) > Math.max(c.y, d.y)) return false;
        var d1 = cross(sub(b, a), sub(c, a)), d2 = cross(sub(b, a), sub(d, a)), d3 = cross(sub(d, c), sub(a, c)), d4 = cross(sub(d, c), sub(b, c));
        return d1 * d2 < -1e-12 && d3 * d4 < -1e-12;
      }
      for (var i = 0; i < n; i++) for (var j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (hit(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
      }
      return false;
    }
    var holes = {}, overlaps = 0, selfCrossing = 0;
    // Bounding boxes and up to 48 sample points per shape keep this quick with
    // hundreds of shapes (lettering): boxes that don't touch can't nest or overlap.
    shapes.forEach(function (A) {
      var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      A.poly.forEach(function (q) { b.x0 = Math.min(b.x0, q.x); b.y0 = Math.min(b.y0, q.y); b.x1 = Math.max(b.x1, q.x); b.y1 = Math.max(b.y1, q.y); });
      A.box = b;
      var stepS = Math.max(1, Math.floor(A.poly.length / 48));
      A.sample = A.poly.filter(function (q, i) { return i % stepS === 0; });
    });
    shapes.forEach(function (A) {
      var depth = 0, overlapped = false;
      if (crosses(A.poly)) selfCrossing++;
      shapes.forEach(function (B) {
        if (A === B || B.area < A.area * 1.0001 + 1e-9) return;
        if (A.box.x1 < B.box.x0 || A.box.x0 > B.box.x1 || A.box.y1 < B.box.y0 || A.box.y0 > B.box.y1) return;
        // most of A's points inside B (a point exactly on B's edge can go either way);
        // some in and some out is an overlap
        var hits = 0;
        for (var i = 0; i < A.sample.length; i++) if (inside(A.sample[i], B.poly)) hits++;
        var f = hits / A.sample.length;
        if (f > 0.5) depth++;
        if (f > 0.1 && f < 0.9) overlapped = true;
      });
      if (overlapped) overlaps++;
      if (depth % 2 === 1) holes[A.n] = true;
    });
    return { holes: holes, overlaps: overlaps, selfCrossing: selfCrossing };
  }

  function processPass(text, cfg, meta, ctx) {
    var lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    var st = { mm: true, abs: true, arcAbs: false, plane: 17, comp: 40, motion: 0, f: null, pos: { x: null, y: null, z: null } };
    var out = [];
    var stats = { strokes: 0, rewritten: 0, closed: 0, swivels: 0, lifted: 0, leadIns: 0, turns: 0, holes: 0, tightArcs: 0, spindleRemoved: 0, rampsDropped: 0, shortRamps: 0, units: null };
    var stroke = null;
    var surface = cfg.surfaceZ;

    function cutting(z) { return z !== null && z < surface - 1e-9; }
    function fail(n, msg) { throw new Error('Line ' + (n + 1) + ': ' + msg); }

    function flush() {
      if (!stroke) return;
      stats.strokes++;
      var res = rewriteStroke(stroke, st, cfg, stats, ctx);
      // left as it was: put the program's own way down back
      if (res === stroke.rawAll && stroke.touch) for (var t = 0; t < stroke.touch.lines.length; t++) out.push(stroke.touch.lines[t]);
      for (var i = 0; i < res.length; i++) out.push(res[i]);
      stroke = null;
    }
    // The program's own way down to (or just above) the top before a cut: straight
    // down, below Hop height. Where the material isn't flat that already cuts, before
    // the blade is lined up: the rewrite comes down itself instead (see rewriteStroke).
    var touch = null;
    function band() { return surface + Math.max(0, cfg.hopHeight) * (st.mm ? 1 : 1 / 25.4); }

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
        // The rewrite writes only motion, so anything else on a cutting move would be
        // lost: refuse it (it belongs on its own line before or after the cut).
        var keepG = [0, 1, 2, 3, 17, 90, 94, 40, 20, 21];
        var lostG = g.filter(function (c) { return keepG.indexOf(c) < 0; }), lostW = Object.keys(other).filter(function (k) { return k !== 'F'; });
        if (stroke && stroke.arcAbs !== st.arcAbs) fail(n, 'G90.1 / G91.1 changes in the middle of a cut aren\'t supported.');
        if (lostG.length || lostW.length) {
          fail(n, (lostG.map(function (c) { return 'G' + c; }).concat(lostW)).join(' ') + ' on a cutting move isn\'t supported: put it on its own line before or after the cut.');
        }
        if (from.x === null || from.y === null || to.x === null || to.y === null) fail(n, 'the X/Y position isn\'t known here (no X/Y move before the cut).');
        if (stats.units === null) stats.units = st.mm ? 'mm' : 'in';
        if (!stroke) {
          if (from.z === null) fail(n, 'the Z height before this cut isn\'t known (no Z move earlier).');
          stroke = { recs: [], comments: [], rawAll: [], start: from, mm: st.mm, arcAbs: st.arcAbs, firstLine: n, travelZ: st.travelZ };
          st.travelZ = null;
          if (touch && touch.x === from.x && touch.y === from.y) {
            // take those moves out; the stroke starts from the height before them
            stroke.touch = { lines: out.splice(touch.at, out.length - touch.at), z: touch.z, f: touch.f };
            stroke.start = { x: from.x, y: from.y, z: touch.z };
          }
          touch = null;
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
        var down = from.x === to.x && from.y === to.y && from.z !== null && to.z !== null && to.z < from.z && to.z < band() - 1e-9;
        if (!down) touch = null;
        else if (!touch) touch = { at: out.length, z: from.z, x: to.x, y: to.y, f: st.f };
        else touch.f = st.f;
        out.push(raw);
        // the program's own travel height: the highest Z between two cuts
        if (to.z !== null && (st.travelZ === null || st.travelZ === undefined || to.z > st.travelZ)) st.travelZ = to.z;
        st.pos = to;
      }
    }
    if (stroke) flush();
    // Nothing to rewrite: hand back the original, unless spindle starts came out:
    // then the program without them, so the spindle can't start (never the original).
    if (stats.rewritten === 0 && stats.spindleRemoved === 0) {
      return { text: text, stats: stats, changed: false };
    }
    var u = stats.units === 'in' ? 'in' : 'mm';
    var header = headerLines([
      'processed: program in ' + u,
      'offset ' + fmt(cfg.offset) + 'mm', 'swivel above ' + fmt(cfg.swivelAngle) + 'deg', 'ramp ' + fmt(cfg.rampLength) + 'mm',
      'lift ' + (cfg.liftAngle > 0 ? 'above ' + fmt(cfg.liftAngle) + 'deg' : 'off'),
      'lead-in ' + (cfg.leadInAngle > 0 ? 'above ' + fmt(cfg.leadInAngle) + 'deg' : 'off')
    ].concat(cfg.leadInAngle > 0 ? [fmt(cfg.leadInLength) + 'mm', 'protect ' + cfg.protect] : [],
      ['spindle ' + (cfg.stripSpindle ? 'removed' : 'kept')],
      meta && meta.source ? ['from ' + commentText(String(meta.source).replace(/[()]/g, ''), 50)] : []));
    var at = out.length && /^\s*%/.test(out[0]) ? 1 : 0;
    out.splice.apply(out, [at, 0].concat(header));
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
  // How many leading elements are a back-and-forth ramp on one line that only goes
  // down and ends where it began (0 when there's none, or nothing would be left).
  function rampZigzag(elems, tol) {
    var e0 = elems[0];
    if (e0.kind !== 'line') return 0;
    var d = mul(sub(e0.to, e0.from), 1 / dist(e0.from, e0.to)), reversed = false;
    for (var k = 0; k < elems.length - 1; k++) {
      var e = elems[k];
      if (e.kind !== 'line' || e.z1 > e.z0 + 1e-9) return 0;
      if (Math.abs(cross(d, sub(e.to, e0.from))) > tol) return 0;   // off the line
      if (k > 0 && dot(sub(e.to, e.from), d) * dot(sub(elems[k - 1].to, elems[k - 1].from), d) < 0) reversed = true;
      if (reversed && dist(e.to, e0.from) < tol && e.z1 < e0.z0 - 1e-9) return k + 1;
    }
    return 0;
  }

  // How many leading elements are a ramp along the path into a closed loop (0 if none).
  function rampOnPath(elems, tol) {
    var last = elems[elems.length - 1], total = elems.reduce(function (t, e) { return t + elemLen(e); }, 0), pre = 0;
    if (dist(elems[0].from, last.to) < tol) return 0;   // already closed
    function nearPath(pt, from) {
      for (var j = from; j < elems.length; j++) {
        var e = elems[j];
        if (e.kind === 'line') {
          var d = sub(e.to, e.from), l2 = dot(d, d), t = l2 ? Math.max(0, Math.min(1, dot(sub(pt, e.from), d) / l2)) : 0;
          if (dist(pt, add(e.from, mul(d, t))) < tol * 4) return true;
        } else {
          for (var q = 0; q <= 32; q++) if (dist(pt, pointAt(e, q / 32)) < tol * 4) return true;
        }
      }
      return false;
    }
    for (var k = 0; k < elems.length - 2; k++) {
      var e = elems[k];
      if (e.z1 > e.z0 + 1e-9) return 0;                     // a ramp only goes down
      pre += elemLen(e);
      if (pre > total * 0.25) return 0;                     // short, against the loop
      if (!nearPath(e.from, k + 1)) return 0;                // and on the rest of the path
      if (dist(e.to, last.to) < tol) return k + 1;          // the loop starts here
    }
    return 0;
  }

  // ---------- lining the blade up before the first cut ----------
  function inPolyPt(p, poly) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  }
  function segDist(p, a, b) {
    var d = sub(b, a), L2 = dot(d, d), t = L2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / L2)) : 0;
    return dist(p, add(a, mul(d, t)));
  }
  // Where to drag the blade into line before the program's first cut, its heading
  // unknown: a straight line 5 offsets long, parallel to the cut's first direction t0,
  // beside its start S on the waste side (outside a part, inside a hole; either side of
  // an open path), 2 to 4 offsets out. The tip stays within an offset of the holder, so
  // the line must keep more than an offset clear of every path, lie in waste (inside an
  // even number of closed shapes), and not cross below X0 or Y0 when the program doesn't.
  // -> { a, b } (the holder's line, along t0) or null when there's no clear place.
  function lineUpPlan(S, t0, r, layout, n, orient) {
    var paths = layout.paths || [], shapes = layout.shapes || [], hole = !!(layout.holes && layout.holes[n]);
    var minX = Infinity, minY = Infinity;
    paths.forEach(function (pp) { pp.forEach(function (q) { minX = Math.min(minX, q.x); minY = Math.min(minY, q.y); }); });
    var left = v(-t0.y, t0.x), sides;
    if (orient !== 0) {
      var inside = orient > 0 ? left : mul(left, -1);
      sides = [hole ? inside : mul(inside, -1)];
    } else sides = [left, mul(left, -1)];
    var L = 5 * r, clear = r * 1.25;   // 5 offsets: even a blade pointing nearly backwards ends within a few degrees
    function ok(q) {
      if (minX >= -1e-9 && q.x - r < 0) return false;
      if (minY >= -1e-9 && q.y - r < 0) return false;
      var inN = 0;
      for (var i = 0; i < shapes.length; i++) if (inPolyPt(q, shapes[i].poly)) inN++;
      if (inN % 2) return false;
      for (var p = 0; p < paths.length; p++) {
        var pp = paths[p];
        for (var k = 1; k < pp.length; k++) if (segDist(q, pp[k - 1], pp[k]) < clear) return false;
      }
      return true;
    }
    for (var di = 2; di <= 4; di++) {
      for (var si = 0; si < sides.length; si++) {
        var base = add(S, mul(sides[si], di * r));
        var lines = [[sub(base, mul(t0, L)), base], [base, add(base, mul(t0, L))]];
        for (var li = 0; li < lines.length; li++) {
          var a = lines[li][0], b = lines[li][1], good = true;
          for (var m = 0; m <= 24 && good; m++) good = ok(add(a, mul(sub(b, a), m / 24)));
          if (good) return { a: a, b: b };
        }
      }
    }
    return null;
  }

  function rewriteStroke(stroke, st, cfg, stats, ctx) {
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

    // A tiny arc between two lines is a sharp corner rounded by a cutter's radius
    // (QuickCut's 0.015 mm, for a 0.03 mm "bit"): the blade can't follow it, and as an
    // arc it hides the corner from lead-ins and lifts. Meet the lines at a point instead.
    var tinyR = Math.min(0.25 * scale, r / 4);
    for (var ti = elems.length - 2; ti >= 1; ti--) {
      var ta = elems[ti];
      if (ta.kind !== 'arc' || dist(ta.from, ta.c) > tinyR) continue;
      var tp = elems[ti - 1], tn = elems[ti + 1];
      if (tp.kind !== 'line' || tn.kind !== 'line' || tn.preZ.length) continue;
      var tu = tangentAt(tp, 1), tw = tangentAt(tn, 0), tx = cross(tu, tw);
      if (Math.abs(tx) < 1e-9) continue;                                   // parallel: no corner
      var tsp = cross(sub(tn.from, tp.to), tw) / tx, X = add(tp.to, mul(tu, tsp));
      if (dist(X, ta.from) > 20 * tinyR || dist(X, ta.to) > 20 * tinyR) continue;
      tp.to = X; tn.from = X; tn.preZ = ta.preZ;
      elems.splice(ti, 1);
      stats.tightArcs--; stats.sharpened = (stats.sharpened || 0) + 1;
    }

    // A ramp-in that zigzags back and forth on one line and comes back to where it
    // started (QuickCut's, most CAM's) is dropped: the rewrite ramps in by itself,
    // and its reversals would otherwise be sharp corners.
    var zz = rampZigzag(elems, tol);
    if (zz) {
      stats.rampsDropped++;
      elems = elems.slice(zz);
    }

    // A ramp along the path into a closed shape (ncCAM's: down along the last edge to the
    // shape's start, round, and back to that start): the path ends on a point it passed
    // early on, over a short descending stretch that lies on the rest of the path. The
    // shape is closed from that point; the stretch before it is dropped (we ramp in ourselves).
    var rp = rampOnPath(elems, tol);
    if (rp) {
      stats.rampsDropped++;
      elems = elems.slice(rp);
    }
    var closed = dist(elems[0].from, elems[elems.length - 1].to) < tol && elems.length > 0;
    if (ctx && ctx.survey) {
      var pp = [elems[0].from];
      elems.forEach(function (e) { var n = e.kind === 'arc' ? 16 : 1; for (var q = 1; q <= n; q++) pp.push(pointAt(e, q / n)); });
      ctx.survey.paths.push(pp);
    }
    // Which way round a closed shape goes: +1 anticlockwise (inside on the left), -1 clockwise.
    var orient = 0, protect = cfg.protect;
    if (closed) {
      var area = 0, poly = [];
      elems.forEach(function (e) {
        var pts = [e.from];
        if (e.kind === 'arc') for (var q = 1; q < 16; q++) pts.push(pointAt(e, q / 16));
        pts.push(e.to);
        for (var q2 = 1; q2 < pts.length; q2++) area += cross(pts[q2 - 1], pts[q2]);
        for (var q3 = 0; q3 < pts.length - 1; q3++) poly.push(pts[q3]);
      });
      orient = area > 0 ? 1 : area < 0 ? -1 : 0;
      if (ctx && ctx.survey) ctx.survey.shapes.push({ n: stats.strokes, poly: poly, area: Math.abs(area) / 2 });
      if (protect === 'auto') {
        var hole = !!(ctx && ctx.holes && ctx.holes[stats.strokes]);
        protect = hole ? 'outside' : 'inside';
        if (hole) stats.holes++;
      }
    }
    var swRad = cfg.swivelAngle * Math.PI / 180, leadRad = cfg.leadInAngle * Math.PI / 180;
    if (!closed && ctx && ctx.survey) {
      var sharp = 0;
      for (var oc = 1; oc < elems.length; oc++) if (Math.abs(turn(tangentAt(elems[oc - 1], 1), tangentAt(elems[oc], 0))) > Math.max(swRad, leadRad)) sharp++;
      if (sharp) { ctx.survey.openPaths++; ctx.survey.openSharp += sharp; }
    }
    // How to get round the corner between a and b: 'link' (let it drag), 'swivel' or 'lead'.
    // A lead-in cuts along b's line extended behind the corner. At a left turn that
    // extension is on the right of the path; at a right turn, on the left. So it's
    // outside an anticlockwise shape at a left turn, inside it at a right turn.
    function cornerKind(a, b) {
      var tr = turn(tangentAt(a, 1), tangentAt(b, 0));
      if (Math.abs(tr) <= swRad) return 'link';
      if (cfg.leadInAngle > 0 && Math.abs(tr) > leadRad && b.z0 < surface && !b.lift) {
        if (protect === 'none') return 'lead';
        if (orient !== 0) {
          var extOutside = (tr > 0) === (orient > 0);
          if ((protect === 'inside') === extOutside) return 'lead';
        }
      }
      return 'swivel';
    }
    // The ramp fits the path: at most 80 % of a closed shape's lap (so the first lap
    // reaches depth and the overcut covers the ramp), half of an open cut.
    var pathLen = elems.reduce(function (t, e) { return t + elemLen(e); }, 0);
    var rampL = Math.min(cfg.rampLength * scale, pathLen * (closed ? 0.8 : 0.5));
    if (cfg.rampLength * scale > rampL + 1e-9) stats.shortRamps++;
    if (closed) {
      stats.closed++;
      // Recut the start at the shape's full depth (its deepest point: the last
      // move may already be ramping out).
      var zFinal = Math.min.apply(null, elems.map(function (e) { return Math.min(e.z0, e.z1); }));
      var overlap = prefix(elems, rampL + r);
      overlap.forEach(function (o) { o.z0 = zFinal; o.z1 = zFinal; });
      // Then lift out while still moving: along the shape (over ground already cut),
      // rising to the surface over liftOut, never more than the rest of the lap.
      var liftL = Math.min(cfg.liftOut * scale, Math.max(0, pathLen - (rampL + r)));
      var liftEls = liftL > 1e-9 ? slicePath(elems, rampL + r, rampL + r + liftL) : [], sL = 0;
      liftEls.forEach(function (o) {
        var L = elemLen(o);
        o.z0 = zFinal + (surface - zFinal) * (sL / liftL); sL += L;
        o.z1 = zFinal + (surface - zFinal) * Math.min(1, sL / liftL);
        o.lift = true; o.preZ = [];
      });
      elems = elems.concat(overlap, liftEls);
      if (liftEls.length) stats.liftedAlong = (stats.liftedAlong || 0) + 1;
    }
    // Going deeper in the middle of a cut (the next pass, straight down): ramp down
    // over the ramp length while moving on, instead of stopping to plunge. The
    // blade is in the cut and lined up, and a dragged blade cuts best moving.
    if (rampL > 0) {
      for (var pk = 1; pk < elems.length; pk++) {
        var pe = elems[pk];
        if (!pe.preZ.length || pe.lift) continue;
        var zFrom = pe.preZ[0].from.z;
        if (zFrom === null || zFrom >= surface - 1e-9 || pe.z0 >= zFrom - 1e-9) continue;
        if (pe.preZ.some(function (q) { return q.to.z > q.from.z + 1e-9; })) continue;   // only going down
        pe.preZ = [];
        stats.passRamps = (stats.passRamps || 0) + 1;
        applyRamp(elems, pk, zFrom, rampL);
      }
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
    // The blade remembers which way it last pointed (the way it was last moving in the
    // material: it keeps that heading in the air). Where that's known and differs from
    // the cut's first direction by more than a swivel, the axis comes down offset from
    // the start along the old heading, so the tip lands exactly on the start; it goes
    // down to a shallow turning depth, swings round the start (the tip turns in place),
    // and ramps on from there. Unknown (the program's first cut): ramp in as before.
    var t0 = tangentAt(elems[0], 0), firstZ = elems[0].z0, heading = ctx && ctx.heading;
    var fromAbove = stroke.start.z > surface - 1e-9;   // above the material, or just touching it
    // The program's first cut, the blade's heading unknown: line it up first in the
    // waste, then come in with the heading known (along t0: no turn needed).
    var lineUp = null;
    if (cfg.lineUp && !heading && ctx && ctx.layout && !ctx.survey && firstZ < surface - 1e-9 && fromAbove) {
      lineUp = lineUpPlan(elems[0].from, t0, r, ctx.layout, stats.strokes, orient);
      if (lineUp) heading = t0;
    }
    var turnAt = null;
    if (cfg.startTurn && heading && firstZ < surface - 1e-9 && fromAbove &&
        Math.abs(turn(heading, t0)) > swRad) {
      turnAt = surface + (firstZ - surface) * cfg.turnDepth;
    }
    // Ramp in from the surface (or the turning depth), replacing the plunge below it.
    // Ramp in from the surface (or the turning depth), replacing the plunge below it.
    // (Not from Hop height: a corner swivel early in the ramp would be in the air.)
    var hopZ = surface + Math.max(0, cfg.hopHeight) * scale;
    var rampIn = rampL > 0 && elems[0].z0 < surface;
    if (rampIn) applyRamp(elems, 0, turnAt !== null ? turnAt : surface, rampL);

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
    for (var ci = 0; ci < stroke.comments.length; ci++) { var cm = commentText(stroke.comments[ci].replace(/^[(;]\s*|\)\s*$/g, ''), LINE_MAX - 2); if (cm) outL.push('(' + cm.replace(/[()]/g, ' ') + ')'); }

    var axis = add(elems[0].from, mul(t0, r));
    var zNow = stroke.start.z;
    // Travels the plugin adds before a cut (off Z0, to and from the line-up) go as
    // high as the program's own travels did, never lower than Hop height: a
    // spring-loaded blade zeroed pressed down still touches 1 mm up.
    var travelZ = Math.max(hopZ, typeof stroke.travelZ === 'number' ? stroke.travelZ : hopZ);
    var plungeF = null;
    for (var lf = 0; lf < lead.length; lf++) if (lead[lf].to.z < surface) plungeF = lead[lf].f;
    // Swing the axis round the tip at P from heading h to heading d, at Z z (the tip
    // turns in place). Returns the new axis.
    function turnInPlace(P, h, d, z, f) {
      var tr0 = turn(h, d), to = add(P, mul(d, r)), ccw0 = tr0 > 0 || Math.abs(Math.abs(tr0) - Math.PI) < 1e-6;
      stats.turns++;
      emit(ccw0 ? 3 : 2, to, z, f, arcWords(P, add(P, mul(h, r))));
      return to;
    }
    // Move over: the axis starts `offset` ahead of the tip's start point (or, to turn
    // in place, along the old heading). A rapid above the work; a feed move when the
    // blade is already down on the surface.
    var landAt = turnAt !== null ? add(elems[0].from, mul(heading, r)) : axis;
    // Just touching the top (QuickCut comes down to Z0 first) and about to line up or
    // turn: lift first, so nothing drags across the top on the way.
    if ((lineUp || turnAt !== null) && zNow < travelZ - 1e-9) { emit(0, null, travelZ, null); zNow = travelZ; }
    if (lineUp) {
      // drag a short line in the waste, shallow, so the blade swings into line
      var zA = surface + (firstZ - surface) * Math.max(0.25, cfg.turnDepth);
      stats.lineUps = (stats.lineUps || 0) + 1;
      outL.push('(dk: line up the blade first, in the waste)');
      emit(0, lineUp.a, null, null);
      if (zNow > hopZ + 1e-9) emit(0, null, hopZ, null);
      emit(1, null, zA, plungeF !== null ? plungeF : (stroke.touch && stroke.touch.f) || elems[0].f);
      emit(1, lineUp.b, null, elems[0].f);
      emit(0, null, travelZ, null);
      zNow = travelZ;
    }
    if (zNow > surface + 1e-9) emit(0, landAt, null, null);
    else emit(1, landAt, null, elems[0].f);
    // back down from the travel height to Hop height, then on as before
    if ((rampIn || turnAt !== null) && zNow > hopZ + 1e-9) { emit(0, null, hopZ, null); zNow = hopZ; }
    var floorZ = turnAt !== null ? turnAt : (rampIn ? surface : -Infinity);
    // down from Hop height to the top at the start, so the ramp starts there (the
    // program's own touch-down was left out)
    if (rampIn && turnAt === null && zNow > surface + 1e-9 && !lead.some(function (q) { return q.to.z < zNow - 1e-9; })) {
      emit(1, null, surface, plungeF !== null ? plungeF : (stroke.touch && stroke.touch.f) || elems[0].f); zNow = surface;
    }
    for (var li = 0; li < lead.length; li++) {
      var lz = lead[li].to.z;
      if (lz < floorZ) lz = floorZ;
      if (Math.abs(lz - zNow) < 1e-9) continue;
      emit(lead[li].mode < 2 ? lead[li].mode : 1, null, lz, lead[li].f);
      zNow = lz;
    }
    if (turnAt !== null) {
      if (Math.abs(turnAt - zNow) > 1e-9) { emit(1, null, turnAt, plungeF !== null ? plungeF : elems[0].f); zNow = turnAt; }
      axis = turnInPlace(elems[0].from, heading, t0, null, elems[0].f);
    }
    if (!rampIn && Math.abs(elems[0].z0 - zNow) > 1e-9) { emit(1, null, elems[0].z0, elems[0].f); zNow = elems[0].z0; }
    for (var k = 0; k < elems.length; k++) {
      var el = elems[k];
      var dS = tangentAt(el, 0), start = add(el.from, mul(dS, r));
      // with vertical moves still to come here, joining keeps the depth; they change it
      var zJoin = el.preZ.length && el.preZ[0].from.z !== null ? el.preZ[0].from.z : el.z0, leadHere = false;
      if (k > 0) {
        var dE = tangentAt(elems[k - 1], 1), tr = turn(dE, dS), kind = cornerKind(elems[k - 1], el);
        if (kind === 'lead') {
          // Hop up, go back along this line extended behind the corner, and cut
          // into the corner from there, reaching depth at the corner: the blade
          // is lined up before the cut proper begins.
          var leadTip = sub(el.from, mul(dS, cfg.leadInLength * scale)), leadStart = add(leadTip, mul(dS, r));
          stats.leadIns++;
          emit(0, null, hopZ, null);
          if (cfg.startTurn) {
            // the blade still points along the side just cut (dE): land so the tip is on
            // the lead-in start, turn it in place there, shallow, then cut in
            var zL = surface + (el.z0 - surface) * cfg.turnDepth;
            emit(0, add(leadTip, mul(dE, r)), null, null);
            emit(1, null, zL, plungeF !== null ? plungeF : el.f);
            turnInPlace(leadTip, dE, dS, null, el.f);
          } else {
            emit(0, leadStart, null, null);
            emit(1, null, surface, plungeF !== null ? plungeF : el.f);
          }
          emit(1, start, el.z0, el.f);
          zJoin = el.z0; leadHere = true;
        } else if (kind === 'swivel') {
          // Swivel: the axis swings around the tip at the corner.
          var C = el.from, ccw = tr > 0 || Math.abs(Math.abs(tr) - Math.PI) < 1e-6;
          stats.swivels++;
          emit(ccw ? 3 : 2, start, Math.abs(zJoin - zNow) > 1e-9 ? zJoin : null, el.f, arcWords(C, axis));
        } else if (dist(axis, start) > 1e-7 || Math.abs(zJoin - zNow) > 1e-9) {
          emit(1, start, Math.abs(zJoin - zNow) > 1e-9 ? zJoin : null, el.f);
        }
        axis = start; zNow = zJoin;
      }
      for (var pz = 0; pz < el.preZ.length && !leadHere; pz++) {   // a lead-in came down to el.z0 already
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
    if (closed && cfg.liftOut > 0 && zNow < surface - 1e-9) {
      var dOut = tangentAt(elems[elems.length - 1], 1);
      emit(1, add(axis, mul(dOut, cfg.liftOut * scale)), surface, elems[elems.length - 1].f);
      zNow = surface;
    }
    // The blade leaves pointing the way it last moved; it keeps that in the air.
    if (ctx) ctx.heading = tangentAt(elems[elems.length - 1], 1);
    for (var ti = 0; ti < trail.length; ti++) {
      var tz = trail[ti].to.z;
      if (Math.abs(tz - zNow) < 1e-9) continue;
      emit(trail[ti].mode < 2 ? trail[ti].mode : 1, null, tz, trail[ti].f);
      zNow = tz;
    }
    // Leave the modal state (motion mode, feed) as the original would have.
    var restore = '';
    if (mode !== st.motion && st.motion < 2) restore += 'G' + st.motion;
    if (st.f !== null && feed !== st.f) restore += (restore ? ' ' : '') + 'F' + fmt(st.f);
    if (restore) outL.push(restore);
    return outL;
  }

  // For pictures: the axis positions every `step` along a program's moves (G0-G3,
  // absolute, G17; G53 lines read as "up out of the way"), and where a dragged
  // blade's tip would be at each (it trails by r while below the surface, keeps
  // its heading in the air).
  function trace(text, step) {
    var pos = { x: 0, y: 0, z: 10 }, motion = 0, arcAbs = false, out = [];
    text.split(/\r?\n/).forEach(function (raw) {
      var p = parseLine(raw);
      if (p.special) return;
      if (/G53\b/i.test(p.code)) { if (/Z/i.test(p.code)) pos = { x: pos.x, y: pos.y, z: 10 }; return; }
      var ax = {}, isMove = false;
      p.words.forEach(function (w) {
        if (w.l === 'G') { var g = Math.round(w.v * 10) / 10; if (g <= 3 && g === Math.floor(g)) motion = g; if (g === 90.1) arcAbs = true; if (g === 91.1) arcAbs = false; }
        else if ('XYZIJ'.indexOf(w.l) >= 0) { ax[w.l] = w.v; if ('XYZ'.indexOf(w.l) >= 0) isMove = true; }
      });
      if (motion >= 2 && (ax.I !== undefined || ax.J !== undefined)) isMove = true;
      if (!isMove) return;
      var to = { x: ax.X !== undefined ? ax.X : pos.x, y: ax.Y !== undefined ? ax.Y : pos.y, z: ax.Z !== undefined ? ax.Z : pos.z };
      var n, i;
      if (motion < 2) {
        n = Math.max(1, Math.ceil(Math.hypot(to.x - pos.x, to.y - pos.y, to.z - pos.z) / step));
        for (i = 1; i <= n; i++) out.push({ x: pos.x + (to.x - pos.x) * i / n, y: pos.y + (to.y - pos.y) * i / n, z: pos.z + (to.z - pos.z) * i / n });
      } else {
        var c = arcAbs ? v(ax.I !== undefined ? ax.I : pos.x, ax.J !== undefined ? ax.J : pos.y) : v(pos.x + (ax.I || 0), pos.y + (ax.J || 0));
        var sw = sweepOf(pos, to, c, motion === 3), R = dist(pos, c), a0 = Math.atan2(pos.y - c.y, pos.x - c.x);
        n = Math.max(2, Math.ceil(Math.abs(sw) * R / step));
        for (i = 1; i <= n; i++) out.push({ x: c.x + R * Math.cos(a0 + sw * i / n), y: c.y + R * Math.sin(a0 + sw * i / n), z: pos.z + (to.z - pos.z) * i / n });
      }
      pos = to;
    });
    return out;
  }
  function dragTip(samples, r, surface) {
    var tip = null, prev = null;
    return samples.map(function (a, i) {
      var inCut = a.z < surface - 1e-9;
      if (tip === null) {
        if (inCut) {
          var j = i; while (j < samples.length - 1 && dist(samples[j + 1], a) < 1e-6) j++;
          var b = samples[Math.min(j + 1, samples.length - 1)], d = dist(a, b) || 1;
          tip = v(a.x - r * (b.x - a.x) / d, a.y - r * (b.y - a.y) / d);
        }
      } else if (inCut) {
        var dd = dist(a, tip);
        if (dd > 1e-12) tip = v(a.x - r * (a.x - tip.x) / dd, a.y - r * (a.y - tip.y) / dd);
      } else tip = v(tip.x + a.x - prev.x, tip.y + a.y - prev.y);
      prev = a;
      return { x: a.x, y: a.y, z: a.z, tip: tip ? v(tip.x, tip.y) : null, cut: inCut && tip !== null };
    });
  }

  // ---------- the offset test ----------
  // Offsets for a test: count values centred on `center`, `step` apart, all above 0
  // (shifted up when the low end would reach 0), rounded to 0.01 mm.
  // A step under 0.01 mm is 0.01 (finer can't be told apart, and rounds to repeats); a
  // step that would reach 0 is made smaller, so the row stays centred on the guess.
  var TEST_STEP_MIN = 0.01;
  function testOffsets(center, step, count) {
    count = Math.max(2, Math.min(9, Math.round(count) || 5));
    step = step > 0 ? step : center * 0.15;
    var half = (count - 1) / 2;
    if (center - step * half < center * 0.1) step = center * 0.9 / half;
    step = Math.max(TEST_STEP_MIN, Math.round(step * 100) / 100);
    var lo = Math.max(TEST_STEP_MIN, center - step * half), out = [];
    for (var i = 0; i < count; i++) out.push(Math.round((lo + i * step) * 100) / 100);
    return out;
  }
  // A tile size that suits the offsets: 4 of the largest, at least 10 mm, rounded.
  function testSize(offs) { return Math.max(10, Math.round(Math.max.apply(null, offs) * 4)); }
  // The test tile, as the blade tip should cut it, from its bottom left corner: a
  // square bottom (two 90 degree corners), walls, a slight bend into a roof (a swivel's
  // worth), and a 40 degree point at the top (sharp: a lead-in or a big swivel).
  // Started mid-bottom, so the start isn't on a corner. In mm.
  function testTile(x0, y0, s) {
    var wall = s * 0.6, h = (s / 2) / Math.tan(20 * Math.PI / 180);
    return [[x0 + s / 2, y0], [x0 + s, y0], [x0 + s, y0 + wall], [x0 + s / 2, y0 + wall + h], [x0, y0 + wall], [x0, y0], [x0 + s / 2, y0]];
  }
  // offsetTest(opts, settings) -> { text, offsets, tiles: [{ n, offset, x }], width, height }
  // A row of test tiles along +X from X0 Y0 (the scrap's front left corner), each
  // processed with its own blade offset and the other settings as given; n short
  // ticks under tile n say which it is. Tile 0, when asked for, is cut as drawn
  // (no correction), unmarked, at the left. In mm (G21), Z from settings.surfaceZ.
  // opts: { offsets: [mm], size: mm, depth: mm, uncorrected: bool, feed: mm/min }
  function offsetTest(opts, rawSettings) {
    var cfg = active(rawSettings);
    // The test is in mm with Z0 on the scrap's top, whatever the program setting says.
    cfg.surfaceZ = 0;
    var offs = (opts.offsets || []).filter(function (o) { return o > 0; });
    if (!offs.length) throw new Error('No offsets to test.');
    var s = opts.size > 0 ? opts.size : testSize(offs), depth = opts.depth > 0 ? opts.depth : 0.3;
    var feed = opts.feed > 0 ? opts.feed : 1000, plunge = Math.max(50, Math.round(feed / 3));
    var top = cfg.surfaceZ, zCut = top - depth, zSafe = top + Math.max(5, cfg.hopHeight + 3);
    var maxOff = Math.max.apply(null, offs);
    // Every corner swivels (no lead-ins): a swivel shows a wrong offset right at the
    // corner (rounded when too small, a loop when too big), where a lead-in would line
    // the blade up anyway and hide it. Each tile gets the lengths that suit its offset,
    // whatever the saved ones are, so tiles differ only by offset: a ramp of 2 offsets
    // and a lift-out of at most 1. The swivel angle, turning depth and the rest are yours.
    cfg.leadInAngle = 0;
    function suited(o) { return { rampLength: 2 * o, liftOut: Math.min(cfg.liftOut, o) }; }
    // room between tiles for the swivels, so no tile cuts its neighbour
    var gap = Math.max(s * 0.5, maxOff * 2 + 2);
    var tickL = s * 0.25, tickGap = Math.max(s * 0.2, maxOff + 1), y0 = gap, yShape = y0 + tickL + tickGap;
    function path(pts) {
      var L = ['G0 X' + fmt(pts[0][0]) + ' Y' + fmt(pts[0][1]), 'G1 Z' + fmt(zCut) + ' F' + plunge];
      for (var i = 1; i < pts.length; i++) L.push('G1 X' + fmt(pts[i][0]) + ' Y' + fmt(pts[i][1]) + (i === 1 ? ' F' + feed : ''));
      L.push('G0 Z' + fmt(zSafe));
      return L;
    }
    var body = [], tiles = [], x = gap, heading = null;
    if (opts.uncorrected) {
      body.push('(tile 0: as drawn, no correction)');
      body = body.concat(path(testTile(x, yShape, s)));
      tiles.push({ n: 0, offset: 0, x: x, y: yShape });
      heading = v(1, 0);   // tile 0 ends along its bottom, going +X
      x += s + gap;
    }
    offs.forEach(function (o, k) {
      var n = k + 1, raw = ['G0 Z' + fmt(zSafe)].concat(path(testTile(x, yShape, s)));
      // n ticks under the tile, spread across its middle
      for (var t = 0; t < n; t++) {
        var tx = x + s * 0.2 + (n === 1 ? s * 0.3 : s * 0.6 * t / (n - 1));
        raw = raw.concat(path([[tx, y0], [tx, y0 + tickL]]));
      }
      var c = {}; for (var key in cfg) c[key] = cfg[key];
      c.offset = o;
      var su = suited(o); c.rampLength = su.rampLength; c.liftOut = su.liftOut;
      // auto: the tile is a part, its ticks open paths; the blade's heading carries over
      var tctx = { heading: heading };
      if (c.protect === 'auto' && c.leadInAngle > 0) tctx.holes = analyzeWith(raw.join('\n') + '\n', c, null).holes;
      var res = processPass(raw.join('\n') + '\n', c, null, tctx);
      heading = tctx.heading;
      body.push('(tile ' + n + ': offset ' + fmt(o) + 'mm)');
      res.text.split('\n').forEach(function (l) { if (l && !/^\(dragknife/i.test(l)) body.push(l); });
      tiles.push({ n: n, offset: o, x: x, y: yShape });
      x += s + gap;
    });
    var height = yShape + s * 0.6 + (s / 2) / Math.tan(20 * Math.PI / 180) + gap;
    var head = headerLines(['processed: offset test, ' + offs.length + ' tiles left to right']
      .concat(offs.map(function (o, k) { return 'tile ' + (k + 1) + ' ' + fmt(o) + 'mm'; }))
      .concat(opts.uncorrected ? ['tile 0 at the left uncorrected'] : [],
        ['corners swivel', 'ramp 2 offsets', 'X0 Y0 front left of scrap', 'Z0 its top', 'depth ' + fmt(depth) + 'mm', 'size ' + fmt(Math.round(x * 10) / 10) + ' x ' + fmt(Math.round(height * 10) / 10) + 'mm']));
    var text = head.concat(['G21 G90 G17', 'G0 Z' + fmt(zSafe)], body, ['G0 Z' + fmt(zSafe), 'M30']).join('\n') + '\n';
    return { text: text, offsets: offs, tiles: tiles, width: x, height: height, size: s, gap: gap };
  }

  return {
    KNIFE_KEYS: KNIFE_KEYS, readKnives: readKnives, readZ: readZ,
    offsetTest: offsetTest, testOffsets: testOffsets, testTile: testTile, isOffsetTest: isOffsetTest, testSize: testSize,
    sourceLabel: function (name) { return commentText(String(name).replace(/[()]/g, ''), 50); }, processedFrom: processedFrom,
    DEFAULTS: DEFAULTS, process: process, analyze: analyze, trace: trace, dragTip: dragTip, readSettings: readSettings, isProcessed: isProcessed,
    parseLine: parseLine, stripSpindleWords: stripSpindleWords, _internal: { turn: turn, tangentAt: tangentAt, elemLen: elemLen, splitAt: splitAt, sweepOf: sweepOf, centerFromR: centerFromR }
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = DragKnife;
