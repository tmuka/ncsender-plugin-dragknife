# Drag Knife (ncSender plugin)

Turns the loaded program into one a drag knife cuts cleanly. A drag knife's blade tip trails the centre of its
holder by a small offset, so a program written for the cut you want rounds off every corner and wanders at the start.
This plugin rewrites the program so the tip follows the path:

![A corner three ways: without the plugin the tip rounds the corner; with a swivel the holder swings around the corner
so the tip turns in place; with a lead-in the knife hops and cuts into the corner along the next side, leaving a short
slit in the waste](docs/images/corners.svg)

*Drawn by the plugin's own processor and drag model, with a 3 mm blade offset so the motion shows.*


- **Offset:** the spindle runs ahead of the tip by the blade offset. Lines shift forward; arcs stay arcs.
- **Corners:** at a turn sharper than *Swivel above*, the spindle swings an arc around the corner so the tip turns
  in place, giving a sharp corner.
- **Into the cut:** each cut starts at the material top and ramps to full depth along the path, so the blade lines
  up while it's shallow. A back-and-forth ramp already in the program (QuickCut's) is replaced by this one.
- **Out of the cut:** closed shapes recut their start at full depth, then rise to the top while still moving.
- **No spindle:** spindle starts (M3/M4) and speeds (S) are removed by default; each line is left commented out and marked
  "removed by Drag Knife". M5 stays.
- **Lead-in corners (on by default; a switch turns them off):** at corners sharper than *Lead in above* (60°), the blade hops up, comes down behind the
  corner on the next line extended, and cuts into the corner along it, so it's lined up before the cut begins. That
  leaves a short tapered slit past the corner; *Keep lead-ins off* chooses the side it may go (the inside of shapes
  when cutting out parts, the outside when cutting holes). Corners on the protected side swivel instead.
  **Auto** (the default) works it out per shape: outlines are parts, a shape inside a part is a hole, a shape inside a
  hole is a part again. The dialog says when it can't (open paths, overlapping shapes, a shape crossing itself) and
  offers the manual choice.
- **Blade:** 6 mm offset by default (large-format CNC drag knives trail by several mm), or pick a vinyl-cutter style
  blade, 30°/45° (0.25 mm) or 60° (0.5 mm), or type your holder's offset. Lengths take any unit
  (`1/4"`, `6mm`).
- **Animation:** the dialog runs the loaded program (or a sample part when none is loaded) through the processor with
  the current settings and animates the knife, to scale, with a close-up that follows the knife. Slits in the waste and slits
  into the part are coloured. Corners already rounded in the program (a CAM tool radius on an outside cut) have
  nothing to lead into: cut on the line, or with a 0 bit diameter, to keep them sharp. A side view shows one lead-in
  corner in 3D, exaggerated.
- **Thick material (optional):** at very sharp corners the blade rises partway while it swivels, then ramps back
  down.

## The dialog

![The Drag Knife dialog: knife settings on the left; on the right a 3D preview of a star with a hole being cut, with a
close-up from above that follows the knife, the legend and what's happening now](docs/images/dialog.png)

The preview runs your loaded program through the processor with your settings while you change them: in 3D (X/Y to
scale, Z stretched so hops show), with a close-up from above that follows the knife, and captions from your numbers
(cut 2 of 3, ramp, depth, lead-in, hop). Scroll or pinch to zoom where you point, drag to move, double-click to see
it all. **Help**, bottom left, opens a page of pictures like the ones above, drawn by
the plugin, and a guide to the settings.

## Processing again

Processing doesn't change the original file: the result replaces only the loaded program. Opening Drag Knife on a
result offers **Process again from the original**, read from File Manager, with the current settings. A program that
isn't in File Manager (a QuickCut program not saved there) can only be processed again with **Save to File Manager**
on: it saves the original and each result to File Manager › Drag Knife.

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
