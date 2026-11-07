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
| Slide drawer | Slides the board tray out to the right |
| Open glass | Swings the GPU door open |
| Airflow | Animated air paths: blue intake, orange exhaust |
| X-ray | Makes the shell see-through |
| Sizes | Overall width, depth and height |

## The design

Two layouts share the same GPU module and board drawer:

```
 Compact (default, ~58 L with 3 × MagAir)    Stacked (~96 L)
 ┌────┬──────────────────────────┐           ┌──────┬────────────────────────┐
 │ S  │ GPU module, glass front  │           │  S   │ GPU module             │
 │ P  │ side intake → roof ↑     │           │  P   │ floor + side intake    │
 │ I  ├──────────────────────────┤           │  I   ├────────────────────────┤
 │ N  │ board flat │ PSU on side │           │  N   │ board drawer           │
 │ E  │ drawer ⇢ slides out      │           │  E   ├────────────────────────┤
 └────┴──────────────────────────┘           │      │ power module, 1-2 PSUs │
                                             └──────┴────────────────────────┘
```

- **Spine (left):** every port leaves the case here: the mains inlet, the board's rear I/O and every GPU output. The hollow column is also the cable chase to the cards. Put this side towards the wall. It's 30 mm thick in Compact and 46 mm in Stacked.
- **GPU module (top):** the cards stand upright with their fans facing the glass, spaced by a set air gap, each on a PCIe 4.0 riser from the board below. Air flows along the gap in front of each card, rises past the vertical fins and leaves through the roof fans.
- **Board drawer:** the motherboard lies flat on a tray that slides out with the CPU cooler and RAM. The lid stays in the case.
- **Compact:** the single PSU stands on its side next to the board and takes mains from the spine through a short internal extension. The GPU module has side intake fans and no floor fans. The risers run just under the drawer lid, over the CPU cooler.
- **Stacked:** adds a power module for one or two PSUs, plus a mesh intake band and floor fans under the cards. It's about 170 mm taller but cools better and can split the load over two supplies.

With three Magnetic Air cards at stock power, a single 1600 W PSU runs at about 94 %. The page suggests a per-card power cap that brings it under 80 % (about 310 W), a bigger supply, or the stacked layout with two supplies.

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
