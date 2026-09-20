/**
 * Fails if a runtime npm dependency ships without a licence notice.
 *
 * `cargo about` reads Cargo metadata, so the generated part of
 * `www/static/third-party-licenses.html` covers the crates compiled into the
 * `.wasm` and nothing else. React's code really does ship too — in the bundle
 * the browser downloads — which makes that file a binary distribution of it in
 * exactly the same way, and MIT conditions binary redistribution on the notice
 * travelling along. Those notices are hand-maintained in `about.hbs`'s
 * "JavaScript in the page" section, and a hand-maintained list is precisely the
 * kind that goes quietly stale when someone adds a dependency.
 *
 * So this checks the one thing the cargo-about diff cannot: that every package
 * which actually reaches a browser is named in that section. There is no third
 * list to keep in step — `about.hbs` is the source of truth, because it is the
 * thing that has to be right.
 *
 * It reads `package-lock.json` rather than running `npm ls`, so it needs no
 * install and no network.
 *
 * devDependencies are deliberately not checked: the bundler, compiler and test
 * runner ship no code to anyone.
 *
 *   node scripts/check-runtime-deps.mjs
 */
import fs from 'node:fs';

const lockPath = new URL('../www/package-lock.json', import.meta.url);
const hbsPath = new URL('../about.hbs', import.meta.url);

const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

const runtime = [
  ...new Set(
    Object.entries(lock.packages ?? {})
      .filter(([path, meta]) => path.startsWith('node_modules/') && !meta.dev && !meta.extraneous)
      // A nested copy is "node_modules/a/node_modules/b" — the package is the
      // segment after the last node_modules/, not the first.
      .map(([path]) => path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)),
  ),
].sort();

const hbs = fs.readFileSync(hbsPath, 'utf8');
const heading = '<h2>JavaScript in the page</h2>';
const start = hbs.indexOf(heading);
if (start === -1) {
  console.error('about.hbs has no "JavaScript in the page" section.');
  process.exit(1);
}
// Up to the next h2, so a package named anywhere else on the page (in a crate
// notice, say) cannot accidentally satisfy this.
const nextHeading = hbs.indexOf('<h2>', start + heading.length);
const section = hbs.slice(start, nextHeading === -1 ? undefined : nextHeading);

const missing = runtime.filter(name => !section.includes(`>${name}</a>`));

if (missing.length > 0) {
  console.error('These runtime npm dependencies ship to the browser with no licence notice:');
  for (const name of missing) console.error(`  - ${name}`);
  console.error('');
  console.error('Add each to about.hbs\'s "JavaScript in the page" section with its licence');
  console.error('text, then regenerate:');
  console.error('  cargo about generate about.hbs -o www/static/third-party-licenses.html');
  process.exit(1);
}

console.log(`All ${runtime.length} runtime npm dependencies are attributed: ${runtime.join(', ')}`);
