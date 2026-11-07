# 臺北 Taipei Planner (1949–2100)

A 3D browser city-planning game set in Taipei's 12 present-day districts, in the spirit of Cities: Skylines. You start in January 1949
with the historical old city, the TRA Western and Tamsui lines and Songshan Airport, and plan the
city through to 2100.

**▶ Play in your browser: https://pork0817.github.io/taipei-planner/**

## Run locally

```bash
python3 serve.py 8765
```

Then open http://localhost:8765. There is no build step and nothing to install: plain ES modules
plus a vendored copy of Three.js (`vendor/three.module.min.js`, r160). A server is needed because
browsers block ES modules on `file://`.

### 3D controls

| Action | Control |
| --- | --- |
| Pan (grab the ground) | Left-drag, or arrow keys |
| Rotate and tilt | Right-drag, or `[` and `]` |
| Zoom toward the cursor | Scroll wheel |
| Whole city | `F` |
| Pause / speed | `Space`, `1`–`4` |

## What you can do

- **Roads:** street, avenue, boulevard, highway, expressway (grade-separated) and pedestrian street,
  drawn freehand or laid out as a street grid. Each road has lanes per direction, one-way or two-way,
  speed limit, sidewalk width, arcade (騎樓), trees, bike lane (none, painted or protected),
  bus lane, and traffic signals (on/off, cycle length, green split). There are four design styles:
  🇳🇱 Dutch, 🇯🇵 Japanese, 🇬🇧 British and 🇺🇸 American.
- **Zoning:** residential, commercial, mixed-use, office and industrial. Each district has a
  zoning law: allowed zones, maximum height, parking minimums, informal growth and a default
  building style.
- **Building heights and styles:** the zoning brush also paints a height limit (≤2 floors up to
  60-floor towers) and an architectural style: Taipei walk-ups with rooftop water tanks, modern
  glass, Japanese, Dutch gabled brick, British terraces or American suburban. "Style & height only"
  restyles parcels without changing their zone. Styles also give small land-value bonuses.
- **Public buildings:** parks, schools, hospitals, night markets, universities and airports.
- **Transit:** bus routes that follow the road network, metro (tunnelled or elevated), light rail
  and commuter rail. Headway, colour and extensions can be changed, and transfers between lines
  within 300 m are automatic.
- **Inspect anything:** districts, parcels, roads, stations, lines and stops.
- **Statistics:** planner rating, population, GDP, budget, modal share over time, ridership and
  capacity by mode, per-line load, the most congested roads, and a district comparison table.
- **Overlays:** traffic (V/C), density, land value, transit coverage, road access, districts and
  green trip share.

## How the simulation works

| Part | Model |
| --- | --- |
| Growth | Historical regional demand (census-based) × attractiveness. Buildings grow on zoned land with road access, limited by era technology, zoning law, hills and airport height limits. |
| Trips | 2.2 trips per resident per day, sent to destinations with a gravity model on mode logsums. Mixed-use zoning keeps trips short and local. |
| Mode choice | Logit model over walk, bike, scooter, car, bus, metro, LRT and rail, with car/scooter ownership segments that follow history. Street design, sidewalks, bike lanes, styles, parking rules, coverage, headways and crowding all feed in. |
| Roads | Peak-hour assignment with BPR congestion curves plus signal delay (Webster) on every junction, and implicit local alleys. Damped between assessments so it settles on an equilibrium. |
| Economy | Jobs × era productivity, plus agglomeration (accessibility), retail vitality, offices and airport passengers, minus congestion cost. The city collects 3% of GDP plus fares and pays for operations and maintenance. |

The model reruns every 1–6 game months, depending on network size, and also right after each edit.
Cars, scooters, buses and trains in the 3D view are decorative, instanced and spawned mostly
near the camera, so they stay cheap.

### Calibration

`dev/calibrate.html` runs four scripted strategies headlessly (do nothing, historical Taipei,
transit-first, US car city) and prints decade tables. The 2020 historical run lands near real
Taipei shares (metro about 34%, scooter 28%, car 14%, walk 10%). The ratings rank as you would
expect: transit-first B (67) > historical C (61) > car city D (47) > do nothing E (40).

## Code layout

```
js/data/taipei.js  geography (districts, rivers, hills), 1949 seed, historical tables
js/world.js        grid, terrain, district assignment
js/roads.js        road network, styles, intersections, costs, Dijkstra
js/transit.js      stations, lines, bus routes, coverage
js/traffic.js      transport model (demand, mode choice, assignment)
js/sim.js          growth, economy, score, events, game loop tick
js/r3d/            3D renderer: index (camera, picking, previews, labels), terrain,
                   roads (textures, viaducts, interchanges), buildings, transit, vehicles
js/bstyles.js      architectural styles
js/render.js       2D layers reused as 3D ground and overlay textures
js/vehicles.js     traffic movement logic (shared with the 3D vehicles)
dev/               calibration harness
js/ui.js           tools, inspector, statistics      js/save.js  save/load (localStorage)
```
