# Changelog

## Unreleased

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
  Drag Knife on it offers *Process again from the original* with the current settings (the top view shows the
  original). Processing never changes the original file; a temporary original (not in File Manager) is gone once
  processed unless saved.
- *Save to File Manager* (top right, off by default, like QuickCut's): saves each result to File Manager › Drag Knife,
  and a temporary original beside it (never over a different file of the same name), so it can be processed again.
- The dialog closes after processing (warnings show beforehand: the Auto box, and tight arcs under the top view).
- The top view's close-up follows the knife.
- The side view shows your program in 3D (*Your program*: your settings, X/Y to scale, Z stretched, parts shaded,
  slits coloured) or the exaggerated *Example corner*.
- Top and side views share one card with *Top view* / *Side view* buttons, so the one shown fills the column
  (remembered in the browser; only the shown one animates).
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
