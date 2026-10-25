import { areasOf, runChecks } from './checks.js';

// npm run selftest [-- Area …]   e.g.  npm run selftest -- Commands REST
const areas = process.argv.slice(2);
const results = await runChecks({ areas });

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

for (const area of areasOf(results)) {
  console.log(`\n${area}`);
  for (const r of results.filter((x) => x.area === area)) {
    console.log(`  ${r.ok ? green('✔') : red('✘')} ${r.name} ${dim(`${r.ms.toFixed(1)}ms`)}`);
    if (!r.ok) console.log(red(`      ${String(r.error?.stack ?? r.error).split('\n').slice(0, 6).join('\n      ')}`));
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? red(`${failed.length} failed`) : green('all passed')}: ${results.length - failed.length}/${results.length} checks`);
process.exitCode = failed.length ? 1 : 0;
