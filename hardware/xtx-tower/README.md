# XTX Tower

An interactive 3D mockup of a stacked, modular PC case built around three (up to four) Radeon RX 7900 XTX cards. As you change the parts, it re-checks the fit, power, risers and airflow.

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

```
 ┌──────┬───────────────────────────┐
 │      │  GPU module (glass front) │  cards stand on PCIe 4.0 risers
 │  S   │  roof exhaust fans ↑      │  air rises between the cards
 │  P   ├───────────────────────────┤
 │  I   │  Board drawer  ⇢ slides   │  board lies flat, front-to-back air
 │  N   ├───────────────────────────┤
 │  E   │  Power module             │  1-2 ATX supplies, floor intake
 └──────┴───────────────────────────┘
```

- **Spine (left):** every port leaves the case here: mains inlets, the board's rear I/O and every GPU output. The hollow column is also the cable chase from the PSUs to the cards. Put this side towards the wall.
- **GPU module (top):** the cards stand upright with their fans facing the glass, spaced by a set air gap. Air comes in through the mesh band and the side wall, rises past each card's fans and leaves through the roof. The card fins run vertically, so this chimney works with the coolers.
- **Board drawer (middle):** the motherboard lies flat on a tray that slides out with the CPU cooler and RAM. The lid stays in the case and carries the riser pass-throughs.
- **Power module (bottom):** one or two ATX supplies. With two, PSU A feeds the board, the CPU and some cards, PSU B the rest, and every card takes all of its 8-pin plugs from one supply.

## What it checks

- **Fit:** width, depth and height grow from the card size, card count, gaps, board, cooler and PSU length.
- **Power:** sustained DC load, recommended capacity (load × 1.3), the load on each supply against an 80 % target, 8-pin outputs, and wall draw against the breaker.
- **Risers:** path length from each slot to its card, the stock length to buy, and the lane split you get on that platform.
- **Airflow:** heat from the cards against intake and exhaust fans, giving a rough exhaust temperature rise.

Card sizes and power come from the makers or from reviews (sources are linked on the page). ASUS publishes no board power for the TUF, so the model assumes 400 W. Slot positions, lane splits and fan flow are typical values: check your own parts before you buy risers or cut metal.

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
