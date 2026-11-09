# Drag Knife (ncSender plugin)

Turns the loaded program into one a drag knife cuts cleanly. A drag knife's blade tip trails the centre of its
holder by a small offset, so a program written for the cut you want rounds off every corner and wanders at the start.
This plugin rewrites the program so the tip follows the path:

- **Offset:** the spindle runs ahead of the tip by the blade offset. Lines shift forward; arcs stay arcs.
- **Corners:** at a turn sharper than *Swivel above*, the spindle swings an arc around the corner so the tip turns
  in place, giving a sharp corner.
- **Into the cut:** each cut starts at the material top and ramps to full depth along the path, so the blade lines
  up while it's shallow.
- **Out of the cut:** closed shapes recut their start at full depth, then rise to the top while still moving.
- **No spindle:** spindle starts (M3/M4) and speeds (S) are removed by default, each left as a comment; M5 stays.
- **Thick material (optional):** at very sharp corners the blade rises partway while it swivels, then ramps back
  down.

## Use

1. Load the program for the cut. Z0 should be the top of the material, and the cut is the shape you want.
2. Open **Drag Knife** from the tools menu and set the **Blade offset**: about 0.25 mm for a 45° blade, 0.5 mm for
   a 60° blade.
3. Press **Process for drag knife**. The rewritten program loads as `<name>-dragknife.nc`. Check it in the preview,
   then run it.

Settings are saved as you change them. Lengths are in mm; inch programs are handled.

## What it won't rewrite

It stops with the line number instead of guessing on incremental moves (G91) or cutter compensation (G41/G42)
while cutting, arcs outside the XY plane, canned cycles, commands such as M3 in the middle of a cut, and programs it
has already processed (load the original instead).

## Development

`npm test` runs the tests, including a drag simulator that follows the blade tip along the rewritten program and
checks it stays on the original path and reaches every corner. `lib/drag-knife.cjs` is copied into `config.html` by
`npm run inline`. See `docs/PLAN.md`.

License: GPL-3.0.
