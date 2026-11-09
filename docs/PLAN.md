# Drag Knife plugin: plan

An ncSender plugin (`com.tmuka.drag-knife`) that rewrites a loaded program for a drag knife: the blade tip trails
the spindle axis by a fixed offset, so the program the CAM wrote (the path the *tip* should cut) has to become the
path the *axis* must follow. It adds the corner swivels, the lead-in that orients the blade before full depth, and the
lead-out that finishes the cut, in X, Y and Z. GPL-3.0, like the other plugins.

## Decisions (2026-11-09)

- **v0.1 is a button, not a hook.** The dialog has one action, *Process for drag knife*, that rewrites the program
  loaded now (download `/api/gcode-files/current/download`, rewrite in the dialog, load the result with
  `/api/gcode-files/load-temp` as `<name>-dragknife.nc`). No `onGcodeProgramLoad`, no `commands.js`.
- **Automatic processing comes later and is optional**, triggered by the knife's **tool number only** (no header
  comment or filename pattern). Off by default: some people won't want every drag knife program rewritten. It's for
  QuickCut and other plugins that make G-code without CAM.
- **A richer UI later** follows QuickCut's dialog layout (sidebar, preview).

## How the host runs it (checked in the ncSender source)

- Manifest `"events": ["onGcodeProgramLoad"]`, `"commands": "commands.js"`.
- `GcodeFileService.ApplyPluginTransforms` → `PluginManager.ApplyOnGcodeProgramLoad` → `JsPluginEngine.ProcessOnGcodeProgramLoad`
  calls `onGcodeProgramLoad(content, { filename, sourcePath }, settings)` **synchronously** in Jint and uses the
  returned string; anything else keeps the original.
- If the plugin throws or isn't running, the program still loads but jobs are refused until it's reloaded
  (`SetProgramMissedBy`). So: never throw for programs we don't own; catch internally, return `content` and
  `pluginContext.showNotice` the reason.
- Jint: 50 MB memory limit, no timeout, ESM `export {}` stripped. `buildInitialConfig(raw)` is required in
  `commands.js` and its result is the `settings` argument. Plain ES2017-ish JS, no `require` at runtime: the libs are
  bundled into `commands.js` (and copied into `config.html` between `/* BEGIN lib/x.cjs */` markers, as Laser Toolbox does).
- The hook runs on **every** load, for every program, and again on reload. It must be cheap to skip and idempotent.

## When it acts, once automatic (milestone 4; so router programs are never touched)

Only while the knife tool is selected: `T<knifeTool>` on an `M6`/`T` line; only the stretch while that tool is
active is rewritten, so a mixed program (router pocket then knife) works. Off unless the user turns it on.

Skip, with a notice, if the program already carries our marker `(dragknife v1 offset=… processed)` (reload safety),
or uses things we won't rewrite: `G91` in a cutting stretch, `G41/G42`, `G18/G19` while cutting, canned cycles,
A/B/C axes, `G93`. Mention the line number.

## The geometry

Notation: tip path = what the file says. `r` = blade offset (the tip's horizontal lag behind the axis). At tip point
`P` with unit travel direction `t`, the axis must be at `A = P + r·t`.

**Lines.** A tip segment `P0→P1` with direction `d` becomes axis `P0 + r·d → P1 + r·d`: the same line shifted forward
by `r` (so the end is overshot by `r` and the tip reaches the corner exactly).

**Arcs (G2/G3) stay arcs, exactly.** Tip on a circle centre `O`, radius `R`: `A = P + r·t` lies on the concentric
circle of radius `√(R² + r²)`, rotated forward by `atan(r/R)`. Emit G2/G3 with the same centre and direction, new
endpoints, `I/J` recomputed. No flattening, no chord error. Warn when `R < r` (the blade can't follow tighter than
about its offset), and optionally replace those arcs with a swivel-style treatment.

**Corners (swivel).** At a tip corner `C` between direction `d1` and `d2`, turn angle `θ = angle(d1, d2)`:

- `θ ≤ swivelThreshold` (default 10°): no swivel; the next segment starts at `C + r·d2` straight from `C + r·d1`
  (a short link, error < r·θ).
- `θ > swivelThreshold`: arc of radius `r` centred on `C` from `C + r·d1` to `C + r·d2`; `G3` for a left turn
  (cross(d1,d2) > 0), `G2` for a right turn; `I,J = −r·d1`. The tip pivots in place at the corner: that's what makes a
  sharp corner. For θ ≈ 180° pick the turn that keeps the arc over waste (outside a closed contour's material side if
  known, else a fixed side).
- `θ > liftThreshold` (default 90°): the swivel is a **helical** arc (G2/G3 with Z): rise to `cutZ + swivelLift`
  (default 50 % of depth, so the tip stays in the material but drags less), swivel, then a short XYZ ramp back to
  `cutZ` along `d2` over `rampBack` (default 2·r). Less tearing on thick vinyl, card and foam; off by default for
  thin film where the plain swivel is cleaner.

Tangent-continuous joins (line→arc, arc→arc within the threshold) get no swivel: the tangent rule handles them.

## Lead-in corners (0.1.0-test.3, the user's request 2026-11-09)

At a turn sharper than `leadInAngle` (0 = off): the tip finishes the line at the corner C; hop to `surface + hopHeight`;
rapid to the axis point for L = C − leadInLength·d2 (the next line extended behind C); drop to the surface; feed to
C + r·d2 ramping to depth, so the blade has dragged `leadInLength` along d2 before the corner. The slit lies on d2's
extension: on the right of the path at a left turn, the left at a right turn. With the shape's winding (signed
area), that's outside the shape at convex corners and inside it at concave ones. `protect` (inside | outside | none)
says which side must stay untouched; a corner whose slit would land there swivels instead. Open paths have no side:
they swivel unless `protect` is none. Lead-in corners don't also lift.

Later: `protect: auto` from nesting (a closed shape inside another is a hole, so protect its outside).

## Lead-in and lead-out (orienting the blade)

At the plunge the blade points anywhere. It only turns when dragged through material, so orient it on the way in:

- **Closed contours (default: ramp along the path).** Rotate the loop's start to the middle of its longest straight
  run (never a corner). Plunge to the surface (`topZ`) at `P0 + r·d0`, then cut along the path ramping Z from `topZ`
  to `cutZ` over `rampLength` (default 5·r, at least 1 mm). The blade aligns while it's shallow. Go round; at the
  end continue past the start at full depth for `overlap` (default `rampLength + r`) so the ramped stretch is recut
  at depth, then ramp up over `r` while still moving and retract. No marks outside the shape.
- **Open paths.** Same ramp-in along the first segment (or the first `rampLength` of the path, swivels included).
  Lead-out: extend the last segment by `r` at depth (the tip reaches the end point), then lift while moving forward
  `leadOutLift` (default r) so the blade doesn't hook back. Option `alignStroke`: before the cut, a short
  shallow stroke of `2r` along `d0` *ending* at the start point, for media where a few mm of over-run is fine.
- Plunge and ramp feeds: `plungeFeed`, and the ramp uses the program's feed.

## Z: telling cuts from travel

Work in "strokes": a stroke starts when Z goes below `cutThreshold` (default `0`, work Z0 on the media surface) and
ends when it rises above it. `cutZ` = the stroke's deepest Z; `topZ` = `max(cutThreshold, 0)`. Rapids and travel
are passed through. A stroke whose depth varies along it (3D) is rewritten in XY and its Z interpolated along the new
path; warn.

## Other rewriting

- Units: offsets are set in mm; `G20` programs get them converted. Absolute arcs `G90.1` honoured; `R`-form arcs
  converted to `I/J` first.
- Spindle: `M3/M4/M5`, `S` dropped inside knife stretches when `stripSpindle` is on (default on), so the spindle
  never runs with a knife in it. Coolant left alone.
- Feeds preserved per segment; swivels use `swivelFeed` (default the stroke's feed).
- Comments kept; each rewritten stroke gets `(dk: stroke n, k swivels)` when `annotate` is on.
- Header: `(dragknife v1 offset=0.25mm threshold=10 processed)`, the marker for idempotence.

## Settings (config.html)

| Setting | Default | |
| --- | --- | --- |
| Enabled | on | master switch |
| Knife tool number | 99 | triggers rewriting while selected |
| Filename pattern | `*.knife.nc, *_dk.*` | second trigger |
| Blade offset `r` | 0.25 mm | ~0.25 mm for 45° blades, ~0.5 mm for 60°; calibrate |
| Swivel threshold | 10° | below this, no corner arc |
| Lift threshold / swivel lift | 90° / 50 % of depth | helical swivel; off for thin film |
| Ramp length / overlap | 5·r / ramp + r | lead-in and closed-loop overlap |
| Lead-out extension / lift | r / r | open paths |
| Cut threshold Z | 0 | below = cutting |
| Strip spindle commands | on | |
| Annotate | on | comments per stroke |

Settings save through the plugin settings API like the other plugins; `buildInitialConfig` sanitises them.

## Calibration (finding the best corners)

A **Calibrate** tab generates a test program (loaded via the `gcode.modify` permission, as Laser Toolbox does): a row
of 10 mm squares, each with a 45° notch and a small star, cut with offsets `r` from 0.10 to 0.60 mm in 0.05 steps,
each labelled with its offset (stroke font from QuickCut/Spoilboard Toolbox). Too small: rounded corners, notches
overcut short. Too large: corners get hooks/ears. The user taps the best square and it becomes `r`. The test is
cut at the user's real material depth, which also absorbs the depth effect (on an angled blade the edge at the
surface sits a little nearer the axis than the tip). A second test compares swivel threshold and lift settings at
the chosen `r`.

## Files

| File | What |
| --- | --- |
| `manifest.json` | id, `events: ["onGcodeProgramLoad"]`, `commands: "commands.js"`, `permissions: ["gcode.modify"]`, toolMenu, `platforms.pro-v2` |
| `lib/gcode-parse.cjs` | modal state machine: G0/1/2/3, G17-19, G20/21, G90/91, G90.1, F, T/M6, comments; line-number tracking |
| `lib/strokes.cjs` | split into travel and knife strokes; closed-loop detection (end within 0.01 mm of start) and start rotation |
| `lib/knife-geom.cjs` | the tangent rule, arc mapping, swivels, helical lift, ramps, lead-out; pure functions |
| `lib/emit.cjs` | write G-code with fixed precision (3 dp mm / 4 dp inch), keep feeds and comments |
| `lib/calibrate.cjs` | the test programs |
| `commands.js` (built) | `buildInitialConfig`, `onGcodeProgramLoad`; libs bundled by `build.mjs` |
| `config.html` | settings, calibration, a before/after preview of a stroke |
| `tests/` | below |

## Tests

- **Drag simulator** (`tests/drag-sim.cjs`): given an axis path, integrate the trailing tip (the tip moves toward the
  axis, keeping distance `r`: a tractrix step in small increments). Run the rewritten program through it and measure
  the Hausdorff distance between the simulated tip path and the original program's path, per stroke. Target: within
  0.02 mm away from corners and the corner point itself reached within 0.02 mm. The same test on the *unprocessed*
  program shows the error we fix (rounded corners), which keeps the simulator honest.
- Unit cases: square, triangle (sharp 120° turns), 180° reversal, star, circle, line→arc→line, arcs with `R < r`,
  inch program, `R`-form arcs, mixed router + knife program (router part byte-identical), already-processed file
  (unchanged), `G91` stretch (unchanged + notice), empty file, 200k-line file under Jint's memory limit and in a
  sensible time (measure with Jint or a Node run with a similar budget).
- Config UI: the test kit (`~/Documents/projects/ncsender-plugin-testkit`), `openLocal({ config: 'config.html',
  pluginId: 'com.tmuka.drag-knife', settings: {} })`.
- On the machine: the Pi dev instance (:8091) first, then a real cut of the calibration program on vinyl and card.

## Milestones

1. **Done in 0.1.0 (test builds):** parser, cut splitter, lines and arcs (exact), swivels, helical lifted swivels,
   ramp-in, closed-shape overlap at final depth and lift-out, inch programs, guards (G91, G41/42, G18/19 arcs,
   canned cycles, commands inside a cut, already processed), the button dialog, drag simulator tests.
   0.1.0-test.3 adds lead-in corners. 0.1.0-test.2 added spindle stripping (M3/M4 and S removed, on by default; M5 kept). Not yet: closed shapes start where the program starts them.
2. On the machine: cut squares, stars and circles in vinyl and card; tune the defaults.
3. Calibration programs (offset ladder) in the dialog.
4. Optional automatic processing on load, by tool number (`onGcodeProgramLoad` in `commands.js`, off by default).
5. QuickCut-style dialog with a before/after preview; closed-loop start moved off corners.
6. Release workflow, README screenshots, registry entry.

## Open questions

- Does any CAM the user runs for the knife emit `G41/G42` or incremental moves? If so, resolve them before rewriting
  rather than skipping.
- Is a drag knife ever mounted with an offset from the spindle centre (like the laser)? If yes, add an XY mount
  offset applied to knife stretches.
