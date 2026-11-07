# 3D overhaul plan (requested 2026-11-08)

User feedback: lacks optimisation; district borders pixelated; houses in water; main roads don't look
like real roads; airport poorly made; building models bad. Use free online 3D models.

## Done so far
- Steps 1-6 done and pushed: Kenney models with LOD, water-safe lots with road clearance, smooth rivers
  and district borders, realistic roads (medians, curbs, junction polygons), new airport, Kenney cars.
- Step 7 done: shadows render only on camera/scene change, buildings rebuild only when the grid
  signature changes (adaptive interval), moving vehicles don't cast shadows.
- Fixes: rivers were culled (wrong winding) and lost to depth precision when zoomed out; hill edges
  were pixel-stepped in the ground texture (now shader-only forest); roads bridge over river banks.
- Car models face +z (checked: cabin sits at -z), matching the vehicle rotation. All steps complete.
- Downloaded Kenney CC0 kits (commercial, suburban, industrial, cars) into `assets/models/*` (GLB +
  `Textures/colormap.png`, License.txt per kit).
- Vendored `vendor/jsm/loaders/GLTFLoader.js` + `vendor/jsm/utils/BufferGeometryUtils.js` (three r160),
  added an import map for `three` in index.html.
- Measured models: commercial building-a..n (1-5k tris, ~0.9-2.3 wide, 0.9-3.2 tall), skyscraper-a..e
  (1.3 wide, 2.9-5.5 tall); suburban building-type-a..u houses (~1.3x1x1); industrial building-a..t;
  cars sedan/taxi/suv/van/police/delivery/truck (~1.5x1.3x2.7, model long axis = z);
  tree-large/tree-small (42 tris). Low-detail commercial models are tall narrow towers — not used.

## Remaining steps
1. `js/r3d/models.js`: load GLBs, merge meshes per model, centre x/z, base y=0, Lambert + colormap.
2. Buildings: per-lot records choose a model by zone/level/aspect; NEAR ring (radius ~ clamp(dist*1.1,
   0.35,1.4) km around camera target) draws model InstancedMeshes; far = existing box meshes with a
   shader uniform hiding instances inside the near ring. Repartition on camera move. Skip lots in water
   (distance to river polylines). Specials/trees not hidden.
3. Smooth ground: rivers as smooth ribbon meshes from RIVERS polylines (animated water shader),
   no cell-based water in the texture; vector-drawn higher-res ground texture (outline, hills blurred);
   smooth district borders via marching squares + Chaikin; overlay LinearFilter.
4. Roads: realistic cross-sections (boulevard median with trees, raised sidewalks/curbs), trimmed
   edges at junctions with convex-hull junction polygons, crosswalks, cap far widening.
5. Airport: runway texture with markings, taxiway, apron, terminal, control tower, procedural airliners.
6. Vehicles: Kenney car models instanced (near camera only).
7. Perf: shadow autoUpdate only on change, pixelRatio <= 1.5, incremental building regeneration.
8. Test with `dev/shots.js` (`S.setup(); S.shot('city')`), then commit and `git push` (GitHub Pages
   at https://pork0817.github.io/taipei-planner/ — user approved public repo).
