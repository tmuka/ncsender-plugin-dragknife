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
- Every line it writes works on Grbl, grblHAL and FluidNC: 79 characters at most (the header is split over a few
  lines, long removed lines shortened with "..."), plain ASCII, and no `!`, `?` or `~` in comments.
