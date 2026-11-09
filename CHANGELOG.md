# Changelog

## Unreleased

- First version: a **Process for drag knife** button that rewrites the loaded program (blade offset, corner swivels,
  ramp-in, closed-shape overlap and lift-out, optional lifted swivels for thick material; arcs kept as arcs; mm and inch).
- Lead-in corners (optional): at turns sharper than a set angle, hop up, come down behind the corner on the next
  line extended and cut into the corner along it, so the blade is lined up before the cut; a *Keep lead-ins off* choice
  (inside of shapes, outside, nothing) makes corners whose lead-in would cut the part swivel instead.
- Spindle starts (M3/M4) and S speeds are removed by default, each left as a comment; M5 stays.
