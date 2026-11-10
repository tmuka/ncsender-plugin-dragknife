# Drag Knife: notes for working on it

An ncSender plugin (`com.tmuka.drag-knife`) that rewrites the loaded program for a drag knife. `docs/PLAN.md` is the
plan (decisions at the top); README.md the user guide. GPL-3.0.

## Layout

| File | What |
| --- | --- |
| `config.html` | The dialog: settings, the *Process* button, the top and side views. ncSender runs it inline, so `lib/drag-knife.cjs` and the unit library are copied in between their `/* BEGIN */` / `/* END */` markers by `npm run inline` (`npm test` fails if a copy is stale). |
| `ncsender-unit-input` | The length fields' units (`1/4"`, `6mm`): tmuka/ncsender-unit-input, a dev dependency pinned to a tag in package.json; its `dist/unit-input.global.js` is copied into config.html (`window.NcUnitInput`). `npm install` first. |
| `lib/drag-knife.cjs` | Parser, cut splitter and the rewrite (`DragKnife.process(text, settings, meta)`); pure, no DOM. |
| `tests/sim.cjs` | A G-code runner and a drag model (the tip trails the axis by the offset: a tractrix). |

## The rule

Tip at P moving in direction t → axis at P + r·t. Lines shift forward by r; arcs keep their centre (radius
√(R²+r²)); corners above the swivel angle get an arc of radius r around the corner; cuts ramp in from the surface;
closed shapes recut `ramp + r` at their final depth and lift out moving forward.

## Testing

`npm test`. UI: the test kit (`~/Documents/projects/ncsender-plugin-testkit`), `openLocal({ config: 'config.html',
pluginId: 'com.tmuka.drag-knife', settings: {} })`; with `api: 'pi'` the Pi's loaded program is read (GET) and the
load is caught locally.
