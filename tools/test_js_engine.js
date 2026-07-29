/* Node harness: run the browser self-checks on the CPU JS engine.
 * Usage: node tools/test_js_engine.js [fast|full]
 * fast = TG + Poiseuille (~seconds); full adds the Strouhal case (~minutes). */
"use strict";
const LBM = require("../site/lbm-cpu.js");
const SelfCheck = require("../site/selfcheck.js");

const make = (nx, ny, opts) => new LBM.CpuEngine(nx, ny, opts);

(async () => {
  const mode = process.argv[2] || "fast";
  const results = [];
  results.push(await SelfCheck.taylorGreen(make,
    { n: 64, tau: 0.8, u0: 0.03, steps: 800, tol: 0.025 }));
  results.push(await SelfCheck.poiseuille(make,
    { nx: 8, ny: 33, tau: 0.9, g: 1e-6, steps: 8000, tol: 0.02 }));
  if (mode === "full") {
    results.push(await SelfCheck.strouhal(make,
      { nx: 400, ny: 160, D: 20, U: 0.08, Re: 100, Deff: 22,
        steps: 30000, warmup: 10000, band: [0.14, 0.20] },
      p => process.stdout.write(`\rstrouhal ${(p * 100) | 0}%   `)));
    console.log();
  }
  let fail = 0;
  for (const r of results) {
    const ok = r.pass && (r.extra ? r.extra.massPass !== false : true);
    if (!ok) fail++;
    console.log(`${ok ? "PASS" : "FAIL"} ${r.name}: measured=${r.measured}` +
      ` target=${r.target}${r.extra ? " massDrift=" + r.extra.massDrift : ""}`);
  }
  process.exit(fail ? 1 : 0);
})();
