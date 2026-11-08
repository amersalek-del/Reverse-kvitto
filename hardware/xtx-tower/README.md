# XTX Tower

An interactive 3D mockup of a modular PC case built around three (up to four) Radeon RX 7900 XTX cards, set up by default for three XFX Mercury Magnetic Air cards. As you change the parts, it re-checks the fit, power, risers and airflow.

## Open it

The page loads three.js from cdn.jsdelivr.net, so it needs an internet connection. Browsers block ES modules on `file://`, so serve the folder:

```bash
cd hardware/xtx-tower
python3 -m http.server 8000      # or: npx serve .
# open http://localhost:8000
```

Drag to orbit, scroll or pinch to zoom. Hover over a part (or tap it on a phone) to see what it is.

| Button | What it does |
| --- | --- |
| Explode | Pulls the modules and the spine apart |
| Slide drawer | Slides the board tray out (forwards in Staggered, to the right otherwise) |
| Open glass | Swings the GPU door open |
| Airflow | Animated air paths: blue intake, orange exhaust |
| X-ray | Makes the shell see-through |
| Sizes | Overall width, depth and height |

## The design

Three layouts share the same spine, GPU module and board drawer. The default, **Staggered**, sizes each module to what's inside, so parts stick out:

```
 Staggered (default): 488 × 378 × 437 mm, ~57 L of case with 3 × MagAir

        ┌────┬───────────────────────────┐
        │ S  │ GPU module, glass front   │──┐ overhangs the drawer;
        │ P  │                           │  │ intake fans hang underneath
        │ I  ├──────────────────┬────────┴──┘
        │ N  │ board drawer     │   ↑ air   ┌──────────────┐
        │ E  │ sticks out front │           │ PSU pod      │ sticks out
        └────┴──────────────────┘           └──────────────┘ bottom right
```

- **Spine (left):** every port leaves the case here: the mains inlet, the board's rear I/O and every GPU output. The hollow column is also the cable chase to the cards. Put this side towards the wall.
- **GPU module (top):** the cards stand upright with their fans facing the glass, spaced by a set air gap, each on a PCIe 4.0 riser from the board below. Air flows along the gap in front of each card, rises past the vertical fins and leaves through the roof fans. In Staggered, the long cards make it overhang the drawer, and that overhang carries intake fans that breathe from below.
- **Board drawer:** the motherboard lies flat on a tray that slides out with the CPU cooler and RAM; the lid stays in the case. In Staggered it sticks out past the glass (a slider sets how far), the exposed strip of lid is mesh, and it slides out forwards.
- **PSU pod (Staggered):** a low block at the bottom right that sticks out past the GPU module and carries the name. The PSU lies flat and breathes through the pod's mesh top.
- **Compact:** the same parts in two flush boxes, with the PSU standing on its side next to the board. About 417 × 321 × 437 mm.
- **Stacked:** adds a power module for one or two PSUs plus floor fans under the cards. About 170 mm taller.

With three Magnetic Air cards at stock power, a single 1600 W PSU runs at about 94 %. The page suggests a per-card power cap that brings it under 80 % (about 310 W), a bigger supply, or the stacked layout with two supplies.

Staggered and Compact hold about the same amount of case (around 57 L); Staggered spreads it over a wider footprint so the modules can step out.

## What it checks

- **Fit:** width, depth and height grow from the card size, card count, gaps, board, cooler and PSU length.
- **Power:** sustained DC load after the per-card power limit, the load on each supply against an 80 % target (with the cap that would fix an overload), 8-pin outputs, and wall draw against the breaker.
- **Risers:** path length from each slot to its card, the stock length to buy, and the lane split you get on that platform.
- **Airflow:** heat from the cards against intake and exhaust fans, giving a rough exhaust temperature rise.

Card sizes and power come from the makers or from reviews (sources are linked on the page). XFX quotes 327 W TGP for the Magnetic Air, but reviews measured about 380-393 W, so the model budgets 390 W. ASUS publishes no board power for the TUF, so the model assumes 400 W. Slot positions, lane splits and fan flow are typical values: check your own parts before you buy risers or cut metal.

## Files

```
index.html        page and controls
style.css
js/specs.js       card, board, PSU and circuit data
js/layout.js      pure layout and budget maths (no DOM)
js/scene.js       three.js model and animations
js/main.js        form, report and view wiring
test/             node:test suite for layout.js
```

Run the tests with `node --test "hardware/xtx-tower/test/*.test.js"` from the repo root.
