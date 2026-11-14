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
- **Turn in place before each cut (on by default):** the blade keeps pointing the way it last cut, even in the air.
  Before the next cut, and where it comes down for a lead-in, the holder lands so the tip is exactly on the start, goes
  down to a shallow turning depth (*Turn at*, 25 % of the depth), swings round so the tip turns in place, then ramps in
  already lined up: no scratch off the line at the start. A shape that starts with the knife touching the top (QuickCut
  comes down to Z0 first) lifts by **Hop height** first.
- **Line up the blade before the first cut (on by default):** the program's first cut can't know which way the blade
  points (wherever the last job left it). So before it, the blade drags a short shallow line, 5 offsets long, in the
  waste beside the start: outside a part, inside a hole, an offset clear of every cut, never past X0 or Y0. The mark
  from lining up lands in the waste instead of on your part, and the cut starts lined up. Where there's no clear room,
  the first cut ramps in as before.

  ![Before: the second cut starts with the blade still pointing the way the first cut went, and the tip drags off the
  line. Now: the tip lands on the start, turns in place, then ramps in on the line](docs/images/start-turn.svg)
- **Out of the cut:** closed shapes recut their start at full depth, then rise to the top while still moving along
  the shape (*Lift out over*, never past the rest of the lap).
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
- **Your knives:** once a knife is set up (after the offset test, say), **Save as a knife…** under **Blade** keeps its
  **Blade offset** and how it moves (**Ramp in over**, **Lift out over**, the turn, the lead-in and lift settings)
  under a name. Pick it from the **Blade** menu, under *Your knives*, to switch between knives; **Delete this knife**
  removes it. Changing any of its values shows *Custom* until you save it again under the same name.
- **Animation:** the dialog runs the loaded program (or a sample part when none is loaded) through the processor with
  the current settings and animates the knife, to scale, with a close-up that follows the knife. Slits in the waste and slits
  into the part are coloured. Corners already rounded in the program (a CAM tool radius on an outside cut) have
  nothing to lead into: cut on the line, or with a 0 bit diameter, to keep them sharp. A side view shows one lead-in
  corner in 3D, exaggerated.
- **Thick material, automatically:** deep in thick material a swivel at full depth tears the corner, since the blade's
  whole buried edge sweeps round. So at sharp corners cut deeper than 1 mm, the blade rises three quarters of the
  way to the top (**Lift height** 75 %), swivels there, then ramps back down. **Lift** under *Lift at sharp corners* is **When deeper than** by
  default (set the depth in **Deeper than**); **Always** lifts at every depth, **Off** never.

## Where Z0 is

Under **Knife settings** › *The material*, **Z0 is** says where the loaded program's Z0 is. **Auto** (the default) reads
the program's own note: QuickCut writes `(Z0: the top of the stock)`, and notes that say Z0 is on the bed or under the
stock mean the bed. Without a note, a program that never cuts below Z0 is taken as Z0 on the bed. Choose **The top of
the material** or **The bed** to say it yourself; with the bed, type **Material thickness** so Drag Knife knows where
the top is (cuts ramp in from there). **Other** takes the material top as a Z in the program's units. The line under
them shows the depth of cut that gives, from the loaded program: for example *Depth of cut: 0.5 mm into the material
(deepest Z2.5, the top at Z3). 2.5 mm above the bed.* It warns when nothing cuts below the top, or when a cut goes into
the bed.

## Works well with

- **[QuickCut](https://github.com/siganberg/ncsender-plugin-quickcut)** for shapes: rectangles, circles, stars and more.
  Cut them *on the line* (or with a 0 bit diameter), load, and process. Drag Knife replaces QuickCut's back-and-forth
  ramp with its own.
- **ncCut2D** for simple drag knife cutting of SVG and DXF files: outlines and holes become closed shapes, and Auto
  keeps the lead-ins off the parts.

## The dialog

![The Drag Knife dialog: the Job page's cards on the left (Knife, The material, Corners, Safety); on the right a 3D
preview of a star being cut, with a close-up from above that follows the knife, the legend and what's happening
now](docs/images/dialog.png)

The settings are on two pages of cards. **Job** holds what you check each time: **Knife** (the **Blade** menu with your
saved knives, **Blade offset**, **Save as a knife…**), **The material** (**Z0 is** and the depth of cut), **Corners**
(**Lead into sharp corners**, **Keep lead-ins off**) and **Safety** (**Remove spindle starts**). **Knife setup** holds
what you set once per knife: **Blade** (**Swivel above**), **Into and out of each cut** (ramp, lift-out, the turn and
the line-up), **Lead-ins at sharp corners**, **Lift at sharp corners** and the **Offset test**. A warning on the Job
page points to Knife setup when a length there is too short for the blade offset.

![The Knife setup page: the Blade card (Swivel above), Into and out of each cut (Ramp in over, Lift out over, Turn at,
the turn and line-up switches) and Lead-ins at sharp corners, beside the same preview](docs/images/dialog-setup.png)

On a smaller screen the dialog scrolls as one page; the preview stays in view between the header and the footer.

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

## Finding your blade offset

Under the settings, **Offset test** loads a row of test tiles to cut in scrap (X0 Y0 on its front left corner, Z0 on
its top). Each tile is a square with a sharp 40° point on top, processed with a different blade offset around yours.
Every corner swivels (no lead-ins), so a wrong offset shows right at the corners, and each tile gets a ramp of 2
offsets whatever yours is; the blade turns in place before each cut. Tiles are numbered by short ticks under it; tile 0 at the left, if you keep it, is cut as drawn
with no correction. Cut it, peel it, and open Drag Knife again: under **Which tile cut best?** pick the tile with the
square corners and the sharpest point. That sets your blade offset. Rounded corners and a blunt point mean the offset
is too small; little hooks past the corners mean it's too big. **Narrow it down** then sets a step a third as big for
a finer row around your pick. **Step**, **Tiles** (2 to 9), **Tile width**, **Cut depth** and **Feed** are set in the
card.

![The offset test drawn by the simulator: with a blade that really trails 6 mm, tile 3 (6 mm) comes out sharp while
the smaller offsets round the corners and the larger ones loop at the point; with 5.4 mm, tile 2 is the sharp
one](docs/images/offset-test.svg)

*Drawn by the plugin's own processor and drag model: green is on the line, orange off it. Draw them again with
`node .scripts/diagrams.cjs`.*

### A first guess for large blades: spin it on paper

With a large-format knife (an offset of a few mm), you can measure a starting offset before cutting anything. Tape
a piece of paper to the bed, switch the spindle off at its power (it must not start), and lower the knife until the
tip just touches the paper. Turn the blade by hand through a full turn: its tip swings around the holder's centre and
draws a circle. Measure the circle's diameter across its widest point; **the blade offset is half the diameter**
(a 12 mm circle: 6 mm). Use it as the centre of the **Offset test**, which then finds the exact value. For small
vinyl-cutter blades (0.25 to 0.5 mm) the circle is too small to measure well; start from the Blade presets instead.

## Use

1. Load the program for the cut. Z0 should be the top of the material, and the cut is the shape you want.
2. Open **Drag Knife** from the tools menu and set the **Blade offset**: about 0.25 mm for a 45° blade, 0.5 mm for
   a 60° blade, or find it with the **Offset test** (above).
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
