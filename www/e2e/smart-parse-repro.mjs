// Reproduces the "Smart Parse download reloads the whole page mid-scan"
// report without a real phone or a real 2.2GB model download.
//
// Serves the actual production `dist/` build, but intercepts every
// request to Hugging Face's GLM-OCR CDN and answers with small synthetic
// weights instead -- same chunked-range-request code path
// (`fetchDataFileIntoSession`/`fetchDataChunkCached` in glmOcrFetch.js),
// same number of round trips, just megabytes instead of gigabytes, with
// an artificial per-chunk delay so the download takes a few seconds
// instead of minutes. That's long enough to watch the in-page progress
// readout and catch a reload while it's still in flight.
//
// `version.json`'s buildId is served from a mutable in-memory value so
// this script can flip it mid-download to simulate a deploy landing
// during a scan -- the exact scenario PR #55's activityGuard fix was
// supposed to cover.
//
// Usage: node e2e/smart-parse-repro.mjs [--bump-version] [--headed]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../dist');
const PORT = 4173;

const BUMP_VERSION = process.argv.includes('--bump-version');
const HEADED = process.argv.includes('--headed');

// Small enough to download in a handful of chunks, large enough to give
// a multi-second window of "still downloading" to observe and act on.
const SYNTH_DATA_BYTES = 320 * 1024 * 1024; // per large weights file
const CHUNK_DELAY_MS = 700; // per 32MB range request (see GLM_OCR_CHUNK_BYTES)
const HIDDEN_MID_SCAN = process.argv.includes('--hidden-mid-scan');

// Must match the real build's embedded __BUILD_ID__ (dist/version.json,
// written by webpack at build time) or the very first eager version
// check reloads before the test gets anywhere -- that reload is correct
// behavior (see version-check.js), just not what this script is testing.
const REAL_BUILD_ID = JSON.parse(
  await readFile(path.resolve(__dirname, '../dist/version.json'), 'utf8'),
).buildId;
let currentBuildId = REAL_BUILD_ID;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.json': 'application/json',
};

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const urlPath = req.url.split('?')[0];
      if (urlPath === '/version.json') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ buildId: currentBuildId }));
        return;
      }
      const filePath = path.join(DIST_DIR, urlPath === '/' ? '/index.html' : urlPath);
      try {
        const body = await readFile(filePath);
        res.writeHead(200, {
          'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
        });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Intercepts Hugging Face's GLM-OCR CDN, standing in for the ~2.2GB real
// download with synthetic, much smaller data over the same HEAD/Range
// request shape `glmOcrFetch.js` actually issues.
async function mockGlmOcrCdn(page, log) {
  await page.route('https://huggingface.co/onnx-community/GLM-OCR-ONNX/**', async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();

    if (url.endsWith('.onnx') && !url.endsWith('_data')) {
      // Small graph file -- content doesn't need to be valid ONNX for
      // this repro, since we only care about behavior *during* the
      // chunked data download, not whether inference itself succeeds.
      log(`serving fake graph for ${url.split('/').pop()}`);
      await route.fulfill({ status: 200, body: Buffer.alloc(1024) });
      return;
    }

    if (url.includes('tokenizer.json')) {
      await route.fulfill({ status: 200, body: Buffer.from('{}') });
      return;
    }

    // The large *_data weights file, fetched via HEAD then N Range requests.
    if (method === 'HEAD') {
      await route.fulfill({
        status: 200,
        headers: { 'content-length': String(SYNTH_DATA_BYTES) },
        body: '',
      });
      return;
    }

    const range = request.headers()['range'];
    if (range) {
      const match = /bytes=(\d+)-(\d+)/.exec(range);
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), SYNTH_DATA_BYTES - 1);
      await wait(CHUNK_DELAY_MS);
      log(`chunk ${url.split('/').pop()} bytes=${start}-${end}`);
      await route.fulfill({
        status: 206,
        headers: {
          'content-range': `bytes ${start}-${end}/${SYNTH_DATA_BYTES}`,
          'content-length': String(end - start + 1),
        },
        body: Buffer.alloc(end - start + 1),
      });
      return;
    }

    await route.continue();
  });
}

async function main() {
  const server = await startStaticServer();
  console.log(`[server] serving dist/ on http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    permissions: [], // camera permission NOT granted -- forces CameraCapture's
    // getUserMedia to reject and fall back to the plain file input, same
    // path a desktop-with-no-camera visitor takes.
  });
  const page = await context.newPage();

  const events = [];
  const log = (msg) => {
    const line = `+${Date.now() - t0}ms  ${msg}`;
    events.push(line);
    console.log(line);
  };
  let t0 = Date.now();

  page.on('console', (msg) => log(`console.${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => log(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) =>
    log(`requestfailed: ${req.url()} (${req.failure()?.errorText})`),
  );
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) log(`framenavigated (same-doc or real): ${frame.url()}`);
  });
  page.on('worker', (worker) => {
    log(`worker created: ${worker.url()}`);
    worker.on('close', () => log(`worker closed: ${worker.url()}`));
  });

  await mockGlmOcrCdn(page, log);

  t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/`);
  log('page loaded');

  // Switch to the Transactions tab, then open "Add a transaction" --
  // the receipt-capture sheet only mounts from there (Header.jsx's
  // `.app-tab` nav, TransactionsTab's aria-label="Log Transactions" "+").
  await page.getByRole('button', { name: 'Transactions' }).click();
  log('switched to Transactions tab');
  await page.getByRole('button', { name: 'Log Transactions' }).click();
  log('clicked Add transaction (+)');
  await page.getByRole('tab', { name: 'Receipt' }).click();
  log('switched to Receipt method');

  // Turn on Smart Parse.
  const smartParseCheckbox = page.locator('.field-check input[type="checkbox"]').first();
  await smartParseCheckbox.check();
  log('enabled Smart Parse');

  // Feed a photo straight into CameraCapture's fallback file input --
  // skips the getUserMedia dance, same DOM event a real fallback file
  // pick fires.
  const fileInput = page.locator('input[type="file"][accept="image/*"]');
  await fileInput.setInputFiles(path.resolve(__dirname, '../dist/icon-512.png'));
  log('picked receipt photo');

  // Watch the visible download-progress readout for up to ~15s, the
  // same text a real user watches, and react like the bump/visibility
  // scenarios below ask.
  // Scoped to the dialog -- an unscoped `.empty-state` matches more than
  // one element elsewhere on the page (other tabs' own empty states),
  // which throws a Playwright strict-mode violation that our try/catch
  // was silently swallowing, always leaving `text` empty.
  const progressLocator = page.getByRole('dialog').locator('.empty-state');
  let sawDownloadStart = false;
  let reloaded = false;
  // 'load' fires for a genuine document reload/navigation, unlike
  // 'framenavigated' which also fires for tidyUrl()'s history.replaceState
  // (a same-document, non-reloading URL cleanup).
  page.once('load', () => {
    reloaded = true;
    log('>>> REAL PAGE RELOAD DETECTED (load event)');
  });

  for (let i = 0; i < 60 && !reloaded; i++) {
    let text = '';
    try {
      text = (await progressLocator.textContent({ timeout: 500 })) ?? '';
    } catch {
      // page may be mid-navigation; treat as unknown this tick
    }
    if (text) log(`progress: ${text.trim()}`);
    if (/%|download|running|reading/i.test(text)) sawDownloadStart = true;

    if (sawDownloadStart && i === 3 && BUMP_VERSION) {
      currentBuildId = 'e2e-new-deploy-mid-scan';
      log(`*** simulated new deploy: version.json buildId -> ${currentBuildId}`);
    }

    if (sawDownloadStart && i === 5 && HIDDEN_MID_SCAN) {
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        Object.defineProperty(document, 'visibilityState', {
          value: 'hidden',
          configurable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      log('*** simulated tab going hidden (screen lock / app switch) mid-scan');
    }

    if (sawDownloadStart && i === 12 && HIDDEN_MID_SCAN) {
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          configurable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      log('*** simulated tab coming back to foreground');
    }

    await wait(300);
  }

  const reloadGuard = await page
    .evaluate(() => sessionStorage.getItem('bp:reloaded-for-build'))
    .catch(() => '<could not read, navigation in progress>');

  console.log('\n=== RESULT ===');
  console.log(`reload observed: ${reloaded}`);
  console.log(`sessionStorage bp:reloaded-for-build = ${reloadGuard}`);
  console.log(`final URL: ${page.url()}`);
  console.log('==============\n');

  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
