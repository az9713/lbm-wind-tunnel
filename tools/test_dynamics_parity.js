/* Node: compare site/race.js simulate() to SITE_DATA.dynamicsMeta from Python.
 * Usage: node tools/test_dynamics_parity.js
 * Exit 0 if t_end, gap_end, timescale_ratio within 5% of Python meta. */
"use strict";
const fs = require("fs");
const path = require("path");
const RaceDynamics = require("../site/race.js");

function loadSiteData() {
  const src = fs.readFileSync(path.join(__dirname, "../site/data.js"), "utf8");
  // data.js is `window.SITE_DATA = {...};`
  const m = src.match(/window\.SITE_DATA\s*=\s*(\{[\s\S]*\});\s*$/);
  if (!m) throw new Error("could not parse site/data.js");
  return JSON.parse(m[1]);
}

const DATA = loadSiteData();
const map = RaceDynamics.loadMapFromDrafting(DATA.drafting);
if (!map) {
  console.error("FAIL: no drafting map in SITE_DATA");
  process.exit(1);
}
if (map.gaps.length < 3) {
  console.error("FAIL: need ≥3 tandem-B gaps, got", map.gaps.length);
  process.exit(1);
}

const r = RaceDynamics.simulate(map, { m: 50, gap0: 3.0, dt: 0.01 });
const meta = DATA.dynamicsMeta;
if (!meta) {
  console.error("FAIL: SITE_DATA.dynamicsMeta missing");
  process.exit(1);
}

function relErr(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
}

const checks = [
  ["caught", r.caught === meta.caught, `js=${r.caught} py=${meta.caught}`],
  ["t_end", relErr(r.t_end, meta.t_end) < 0.05,
    `js=${r.t_end.toFixed(4)} py=${meta.t_end} err=${(relErr(r.t_end, meta.t_end) * 100).toFixed(2)}%`],
  ["gap_end", relErr(r.gap_end, meta.gap_end) < 0.05,
    `js=${r.gap_end.toFixed(4)} py=${meta.gap_end} err=${(relErr(r.gap_end, meta.gap_end) * 100).toFixed(2)}%`],
  ["timescale_ratio", relErr(r.timescale_ratio, meta.timescale_ratio) < 0.05,
    `js=${r.timescale_ratio.toFixed(4)} py=${meta.timescale_ratio} err=${(relErr(r.timescale_ratio, meta.timescale_ratio) * 100).toFixed(2)}%`],
  ["ratio_strong", r.timescale_ratio >= 5, `ratio=${r.timescale_ratio.toFixed(2)}`],
];

let fail = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) fail++;
}
// live stepper smoke: advance until catch
const live = RaceDynamics.createLive(map, { gap0: 3.0, m: 50 });
live.start();
let steps = 0;
while (!live.snapshot().caught && steps < 500000) {
  live.step(100);
  steps += 100;
}
const liveSnap = live.snapshot();
const liveOk = liveSnap.caught && liveSnap.gap <= map.gapMin + 0.02;
console.log(`${liveOk ? "PASS" : "FAIL"} live_stepper: caught=${liveSnap.caught} gap=${liveSnap.gap.toFixed(4)} steps=${steps}`);
if (!liveOk) fail++;

process.exit(fail ? 1 : 0);
