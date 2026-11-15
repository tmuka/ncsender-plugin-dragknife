// commands.js: the load hook ncSender's server runs as each program loads.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'commands.js'), 'utf8');
const KNIFE = { id: 41, toolId: 791, name: 'Drag Knife', type: 'drag-knife' };
const MILL = { id: 3, toolId: 3, name: '1/4 Endmill', type: 'flat' };

// A sandbox like ncSender's: a script with a pluginContext global. answer: the button's
// value ('convert', 'skip', or null for none). gate: false for an ncSender without askGate.
function hook({ tools = [KNIFE, MILL], answer = 'convert', gate = true } = {}) {
  const asked = [], gates = [], notices = [];
  const pluginContext = {
    log() {}, getTools: () => tools,
    showDialog: (title, html) => { asked.push(html); return answer === null ? null : { action: answer }; },
    showNotice: (title, msg) => notices.push(msg)
  };
  if (gate) pluginContext.askGate = (o) => { gates.push(o); asked.push(o.message); return answer; };
  const box = { pluginContext };
  vm.createContext(box);
  vm.runInContext(SRC, box);
  return { run: (text, settings) => box.onGcodeProgramLoad(text, { filename: 'star.nc', sourcePath: null }, settings), asked, gates, notices };
}

const square = (head) => [head, 'G21 G90', 'G0 Z5', 'G0 X0 Y0', 'G1 Z-1 F300',
  'G1 X40 F1000', 'G1 Y40', 'G1 X0', 'G1 Y0', 'G0 Z5', 'M30'].join('\n') + '\n';
const BY_TOOL = square('M6 T791');
const BY_QUICKCUT = square('(Entry: straight down, no ramps, for a drag knife)');
const S = { offset: 4.56 };

test('load hook: has what ncSender calls when it starts the script', () => {
  const box = { pluginContext: {} };
  vm.createContext(box);
  vm.runInContext(SRC, box);
  assert.equal(typeof box.buildInitialConfig, 'function');
  assert.equal(typeof box.onGcodeProgramLoad, 'function');
  assert.deepEqual(JSON.parse(JSON.stringify(box.buildInitialConfig({ offset: 3 }))), { offset: 3 });
  assert.doesNotMatch(SRC, /^\s*(import|export)\b/m);
});

test('load hook: a program for a Drag Knife tool asks, and converts on Convert', () => {
  const h = hook();
  const out = h.run(BY_TOOL, S);
  assert.equal(h.asked.length, 1);
  assert.match(h.asked[0], /T791, Drag Knife/);
  assert.match(out, /^\(dragknife processed/m);
  assert.match(out, /from star\.nc/);
});

test('load hook: QuickCut\'s drag knife note is enough', () => {
  const h = hook({ tools: [] });
  assert.match(h.run(BY_QUICKCUT, S), /dragknife processed/);
  assert.match(h.asked[0], /QuickCut made it/);
});

test('load hook: Load as it is, or closing the question, leaves it alone', () => {
  assert.equal(hook({ answer: 'skip' }).run(BY_TOOL, S), BY_TOOL);
  assert.equal(hook({ answer: null }).run(BY_TOOL, S), BY_TOOL);
});

test('load hook: asks with ncSender\'s own prompt, Convert as the default', () => {
  const h = hook();
  h.run(BY_TOOL, S);
  const g = h.gates[0];
  assert.equal(h.gates.length, 1);
  assert.equal(g.messageHtml, true);
  assert.deepEqual(JSON.parse(JSON.stringify(g.buttons.map((b) => [b.value, b.label, b.style, !!b.isDefault]))),
    [['skip', 'Load as it is', 'secondary', false], ['convert', 'Convert', 'primary', true]]);
  assert.match(g.message, /<b>star\.nc<\/b>/);
  assert.match(g.message, /blade offset of 4\.56 mm/);
});

test('load hook: an ncSender without askGate gets the HTML dialog', () => {
  const h = hook({ gate: false });
  assert.match(h.run(BY_TOOL, S), /dragknife processed/);
  assert.match(h.asked[0], /dkq-go/);
  assert.equal(hook({ gate: false, answer: 'skip' }).run(BY_TOOL, S), BY_TOOL);
});

test('load hook: Convert it converts without asking; Do nothing does nothing', () => {
  const c = hook();
  assert.match(c.run(BY_TOOL, { offset: 4.56, onLoad: 'convert' }), /dragknife processed/);
  assert.equal(c.asked.length, 0);
  const off = hook();
  assert.equal(off.run(BY_TOOL, { offset: 4.56, onLoad: 'off' }), BY_TOOL);
  assert.equal(off.asked.length, 0);
});

test('load hook: other programs, mixed tools, processed ones and offset 0 load as they are', () => {
  const h = hook();
  const mill = square('M6 T3'), mixed = square('M6 T791') + 'M6 T3\n', unknown = square('M6 T55');
  [mill, mixed, unknown, square('G0 X0')].forEach((p) => assert.equal(h.run(p, S), p));
  const done = h.run(BY_TOOL, S); h.asked.length = 0;
  assert.equal(h.run(done, S), done, 'its own result, loaded back');
  assert.equal(h.run(BY_TOOL, { offset: 0 }), BY_TOOL);
  assert.equal(h.asked.length, 0);
});

test('load hook: never throws; a program it can\'t convert loads as it is, with a notice', () => {
  const broken = hook({ tools: null });
  broken.run(BY_TOOL, S); // getTools gives nothing: not a knife program by tool
  const h = hook();
  const bad = 'M6 T791\nG21 G90\nG0 Z5\nG1 Z-1 F300\nG2 X10 Y0 F1000\nM30\n'; // an arc with no centre
  const out = h.run(bad, S);
  assert.equal(typeof out, 'string');
  if (out === bad) assert.ok(h.notices.length <= 1);
  const thrower = hook(); thrower.run(null, S);
});

test('load hook: T is the Tool ID only; T0 and words like $ADB_RETRACT 1 aren\'t tools', () => {
  // A knife with no Tool ID whose internal id is 12 doesn't make T12 (an endmill) a knife.
  const clash = hook({ tools: [{ id: 5, toolId: 12, name: 'Endmill', type: 'flat' }, { id: 12, toolId: null, name: 'Knife', type: 'drag-knife' }] });
  const t12 = square('M6 T12');
  assert.equal(clash.run(t12, S), t12);
  assert.equal(clash.asked.length, 0);
  const h = hook();
  assert.match(h.run(square('M6T791') + 'M6 T0\n', S), /dragknife processed/, 'M6T791, then T0 to put it away');
  assert.match(h.run('$ADB_RETRACT 1\n' + BY_TOOL, S), /dragknife processed/);
  assert.equal(h.asked.length, 2);
});

test('load hook: over 4 KB it doesn\'t ask or convert; a notice points to Process', () => {
  let big = 'M6 T791\nG21 G90\nG0 Z5\nG0 X0 Y0\nG1 Z-1 F300\n';
  for (let i = 0; big.length <= 4096; i++) big += 'G1 X' + (i % 2 ? 40 : 0) + ' Y' + i * 0.1 + ' F1000\n';
  big += 'G0 Z5\nM30\n';
  const h = hook();
  assert.equal(h.run(big, S), big);
  assert.equal(h.asked.length, 0);
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0], /over 4 KB, too big to convert as it loads[\s\S]*Process for drag knife/);
});

test('load hook: Convert with nothing to convert says so', () => {
  const h = hook();
  const none = 'M6 T791\nG21 G90\nG0 Z5\nG0 X10 Y10\nM30\n';
  assert.equal(h.run(none, S), none);
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0], /no cuts to convert/);
});
