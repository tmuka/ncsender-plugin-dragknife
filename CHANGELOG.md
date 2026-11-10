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
- The animation uses the loaded program and every current setting, to scale, with a close-up of one corner; a sample
  part when nothing is loaded.
- A back-and-forth ramp-in at the start of a cut (QuickCut's) is dropped, so its reversals no longer become lead-ins.
- The animation is time-based (same speed on any display) with Slow / Normal / Fast (10, 30, 60 s a run; Normal by
  default, remembered in the browser).
- Turning off *Remove spindle starts* (on by default) shows a red warning.
- Full-window dialog like QuickCut's: settings on the left, the views on the right (one column when narrow).
- A side view: one lead-in corner in 3D, exaggerated, with the holder, the trailing blade, the hop and the slit, and
  what each step is for.
- Length fields take any unit through the ncsender-unit-input library (`1/4"`, `6mm`, `2mm+1/16"`) and show the
  operator's units.
- A *Blade* picker: 30° or 45° (0.25 mm offset, the default) or 60° (0.5 mm), setting the lead-in and ramp to suit.
- The dialog closes after processing when there's nothing to warn about.
- Every line it writes works on Grbl, grblHAL and FluidNC: 79 characters at most (the header is split over a few
  lines, long removed lines shortened with "..."), plain ASCII, and no `!`, `?` or `~` in comments.
