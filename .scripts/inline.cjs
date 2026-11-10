// Copies each lib/*.cjs, and the ncsender-unit-input library's browser build
// (window.NcUnitInput; a dev dependency, `npm install` first), into config.html
// between its BEGIN / END markers:
// ncSender runs config.html inline, so it can't load other files.
// `node .scripts/inline.cjs --check` fails when a copy is out of date.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const file = path.join(root, 'config.html');
let html = fs.readFileSync(file, 'utf8');
// [marker, file]: the marker is the name in BEGIN / END.
const libs = [['ncsender-unit-input', 'node_modules/ncsender-unit-input/dist/unit-input.global.js'], 'lib/drag-knife.cjs']
  .map((l) => (Array.isArray(l) ? l : [l, l]));
let stale = [];
for (const [lib, src] of libs) {
  const begin = `/* BEGIN ${lib} */\n`, end = `/* END ${lib} */`;
  const i = html.indexOf(begin), j = html.indexOf(end);
  if (i < 0 || j < i) throw new Error('markers for ' + lib + ' not found');
  if (!fs.existsSync(path.join(root, src))) throw new Error(src + ' not found: run npm install');
  const body = fs.readFileSync(path.join(root, src), 'utf8');
  if (html.slice(i + begin.length, j) !== body) stale.push(lib);
  html = html.slice(0, i + begin.length) + body + html.slice(j);
}
if (process.argv.includes('--check')) {
  if (stale.length) { console.error('out of date in config.html: ' + stale.join(', ') + ' (run node .scripts/inline.cjs)'); process.exit(1); }
} else {
  fs.writeFileSync(file, html);
  console.log(stale.length ? 'updated ' + stale.join(', ') : 'already up to date');
}
