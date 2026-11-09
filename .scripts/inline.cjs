// Copies each lib/*.cjs into config.html between its BEGIN / END markers:
// ncSender runs config.html inline, so it can't load other files.
// `node .scripts/inline.cjs --check` fails when a copy is out of date.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const file = path.join(root, 'config.html');
let html = fs.readFileSync(file, 'utf8');
const libs = ['lib/drag-knife.cjs'];
let stale = [];
for (const lib of libs) {
  const begin = `/* BEGIN ${lib} */\n`, end = `/* END ${lib} */`;
  const i = html.indexOf(begin), j = html.indexOf(end);
  if (i < 0 || j < i) throw new Error('markers for ' + lib + ' not found');
  const body = fs.readFileSync(path.join(root, lib), 'utf8');
  if (html.slice(i + begin.length, j) !== body) stale.push(lib);
  html = html.slice(0, i + begin.length) + body + html.slice(j);
}
if (process.argv.includes('--check')) {
  if (stale.length) { console.error('out of date in config.html: ' + stale.join(', ') + ' (run node .scripts/inline.cjs)'); process.exit(1); }
} else {
  fs.writeFileSync(file, html);
  console.log(stale.length ? 'updated ' + stale.join(', ') : 'already up to date');
}
