# Changelog

## Unreleased

- **One scrollbar:** on smaller screens (laptops at 1366×768 or 1280×720) the dialog scrolls as one page; cards grow to their content instead of scrolling inside. The preview card is exactly the visible height between the dialog's header and footer (a smaller close-up and legend on short windows), stays in view while the settings scroll past, and the footer with **Process** stays at the bottom.
- **Two pages of cards**, like QuickCut's: **Job** (Knife, The material, Corners, Safety) for each time, and **Knife setup** (Blade, Into and out of each cut, Lead-ins, Lift at sharp corners, Offset test) for once per knife. A loaded offset test opens Knife setup; a short-length warning shows on Job too.
- **Z0 is** (under *The material*): Auto (from the program's note, else its heights), the top of the material, the bed (with **Material thickness**), or Other (the old **Material top Z**, kept for settings that set it). A line under it shows the **depth of cut** from the loaded program, and how far above the bed, with warnings when nothing cuts below the top or a cut goes into the bed. A program with Z0 on the bed and no thickness is refused with a message instead of processed wrongly.
- **Line up the blade before the first cut** (on): the program's first cut, its blade direction unknown, used to leave a start mark up to an offset long, inside the part or outside depending on where the last job left the blade (a star: up to 5.9 mm inside). Now the blade first drags a short shallow line in clear waste beside the start; on that star the worst start mark is 0.4 mm, at the very top of the ramp.
- Shapes that start with the knife touching the top (QuickCut comes down to Z0 first) now lift by **Hop height** before moving over, so **Turn the blade in place before each cut** works on them too (it didn't on QuickCut programs).
- **Your knives:** **Save as a knife…** under **Blade** keeps a knife's **Blade offset** and how it moves under a name, to pick from the **Blade** menu (for more than one knife, or after the offset test); **Delete this knife** removes one. Picking a tile in the offset test suggests saving it.

## 0.1.3: Offset test and turning in place

- **Turn in place before each cut:** the blade keeps pointing the way it last cut; before the next cut, and where it comes down for a lead-in, the tip lands on the start, turns there at a shallow depth (*Turn at*, 25 % of the depth), then ramps in already lined up. No more scratch off the line at each start (up to the offset before). The program's first cut still only ramps in.
- **Lift-out follows the shape** over ground already cut, instead of running straight on (a long lift-out ran off the shape past the corner).
- **A warning** when the ramp (under 1 offset) or lead-in (under 2 offsets) is too short for the blade offset, with a button to set 2 and 3 offsets (picking Custom and typing a large offset kept the vinyl blade's 2 mm and 1.5 mm).
- Offset test: **Which tile cut best?** shows tile 0 (uncorrected, greyed out) when the test had it, so the tiles count the same as on the cut.
- README and Help: simulator pictures of turning in place (off and on) and of a whole offset test (the sharp tile moves with the real offset), drawn by `.scripts/diagrams.cjs` and the dialog.
- Offset test: every corner swivels (no lead-ins), where a wrong offset shows plainly, and each tile gets a ramp of 2 offsets and a lift-out of at most 1, whatever yours are; it needs far less scrap.
- **Offset test**: loads a row of test tiles in scrap, each processed with a different blade offset around yours and numbered by ticks; pick the one that cut best to set your blade offset, then **Narrow it down** for a finer row. Help shows what too small, right and too big look like.
- Help, README and the Offset test card: a first guess for large blades. Turn the blade by hand with its tip on paper; the circle it draws is twice the offset.
- Preview: an instant replay in the close-up. After a corner (a swivel or a lead-in) the close-up replays it in smooth slow motion, centred on it, for one whole pass, then again while the knife runs straight, and goes back to live where the cut bends or ends; click the close-up to skip.

## 0.1.2: Clearer preview

- Preview: the holder cylinder is see-through, so the cut lines behind it show.
- Preview: the close-up from above is sized from the blade offset (5 offsets across), so it's magnified more: 30 mm across for a 6 mm offset, was up to 84 mm.

## 0.1.1: Preview follows the knife

- Preview: zoomed in, the view follows the knife, gliding to keep the blade tip in view (it waits a moment after you zoom or pan).
- Preview: lead-in slits are strong amber and slits into a part red, so they stand out from the cut; they were too pale to see.
- The plugin's description in ncSender's plugin list now matches the registry's.

## 0.1.0: First release

- First version: a **Process for drag knife** button that rewrites the loaded program (blade offset, corner swivels,
  ramp-in, closed-shape overlap and lift-out, optional lifted swivels for thick material; arcs kept as arcs; mm and inch).
- Lead-in corners (optional): at turns sharper than a set angle, hop up, come down behind the corner on the next
  line extended and cut into the corner along it, so the blade is lined up before the cut; a *Keep lead-ins off* choice
  (inside of shapes, outside, nothing) makes corners whose lead-in would cut the part swivel instead.
- *Keep lead-ins off* defaults to **Auto**: a shape inside another is a hole (lead-ins stay inside it), a shape inside a
  hole is a part again. The dialog checks the loaded program and says when auto can't decide (open paths with sharp
  corners, overlapping shapes, a shape that crosses itself), with a button for the manual choice.
- An animation in the dialog: the knife cutting a sample part with a notch and a hole under the current corner settings,
  slits in the waste and slits into the part coloured.
- Spindle starts (M3/M4) and S speeds are removed by default; each line is left commented out and marked
  "removed by Drag Knife"; M5 stays.
- Lead-ins have an on/off switch and are **on** by default (above 60°). Settings saved while they were off by a 0
  angle get the new default.
- The animation uses the loaded program and every current setting, to scale, with a close-up that follows the knife; a sample
  part when nothing is loaded.
- A back-and-forth ramp-in at the start of a cut (QuickCut's) is dropped, so its reversals no longer become lead-ins.
- The animation is time-based (same speed on any display) with Slow / Normal / Fast (10, 30, 60 s a run; Normal by
  default, remembered in the browser).
- Turning off *Remove spindle starts* (on by default) shows a red warning.
- Full-window dialog like QuickCut's, with ncSender's own title bar hidden: settings on the left, the top and side
  views on the right filling the height (views on top on a portrait screen); *Process* at the bottom right.
- A side view: one lead-in corner in 3D, exaggerated, with the holder, the trailing blade, the hop and the slit, and
  what each step is for.
- Length fields take any unit through the ncsender-unit-input library (`1/4"`, `6mm`, `2mm+1/16"`) and show the
  operator's units.
- A *Blade* picker: 30° or 45° (0.25 mm offset, the default) or 60° (0.5 mm), setting the lead-in and ramp to suit.
- Processing again: the processed program is loaded with its original's File Manager path as the source, so opening
  Drag Knife on it offers *Process again from the original* with the current settings (the preview shows the
  original). Processing never changes the original file; a temporary original (not in File Manager) is gone once
  processed unless saved.
- *Save to File Manager* (top right, off by default, like QuickCut's): saves each result to File Manager › Drag Knife,
  and a temporary original beside it (never over a different file of the same name), so it can be processed again.
- The dialog closes after processing (warnings show beforehand: the Auto box, and tight arcs beside the preview).
- The close-up follows the knife.
- The side view shows your program in 3D with your settings (X/Y to scale, Z stretched, parts shaded, slits coloured),
  with captions from your numbers (cut 2 of 3, ramp, depth, lead-in length, hop height); the sample part when nothing
  is loaded.
- A *Help* page (button at the bottom left): the corner without the plugin, with a swivel and with a lead-in; parts and holes under
  *Keep lead-ins off*; the depth along a closed cut; the settings and tips. Its pictures are drawn by the processor.
- Defaults for a large-format CNC drag knife: 6 mm blade offset (*Blade: Custom*), lead-in 18 mm, ramp 12 mm.
- Lead-ins switched on always happen: a 0 *Lead in above* (from before the switch, or a cleared field) means 60°.
- Closed shapes entered by a ramp along their own path (as in programs made with ncCAM from an SVG) are recognised as closed: the
  ramp is replaced by Drag Knife's own, and they get the overcut, lift-out and Auto's lead-ins.
- The preview is paced by distance: the knife covers about a sixth of the program's size a second on *Normal* (a twelfth
  on *Slow*, half on *Fast*), so big programs no longer rush by; changing speed keeps its place.
- The preview zooms like ncCAM's: the wheel toward the cursor, a pinch toward the fingers; drag to move when zoomed,
  double-click or *Fit* for everything.
- One preview: the 3D view of your program with a close-up from above that follows the knife, the legend, counts and
  captions beside it (the separate top view is gone).
- Fixes from an independent review:
  - spindle starts written `M3.0` / `M03.00` are removed too, and spindle starts are removed even when no cut is
    rewritten (offset 0, nothing below *Material top Z*); the dialog says so and stays open;
  - words a cutting move would lose (`G55`, `G93`, `G90.1`, `M8`, ...) are refused with a clear message instead of
    being dropped;
  - a closed shape's overcut is at its full depth even when the program ramps out on its last edge;
  - small closed shapes and short open cuts reach full depth (the ramp fits the path);
  - every line written stays within 79 characters; comments copied from the program are made plain;
  - Auto's part/hole check stays quick with hundreds of shapes, and the dialog redraws once changes stop;
  - *Save to File Manager* never overwrites a different file: a result replaces only an earlier result from the same
    original; results name their source with its folder;
  - an emptied angle or percentage field is refused instead of saved as 0.
- Every line it writes works on Grbl, grblHAL and FluidNC: 79 characters at most (the header is split over a few
  lines, long removed lines shortened with "..."), plain ASCII, and no `!`, `?` or `~` in comments.
