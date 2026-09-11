import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import DebugPanel from './components/DebugPanel';
import { startVersionCheck } from './version-check';
import { isActivityInProgress } from './activityGuard';
import { readLastReceiptFailure } from './receiptFailureBreadcrumb';
import { createUnavailableModule } from './unavailable';
import './styles/main.css';

let wasmModule = null;

async function initWasm() {
  try {
    const wasm = await import('../pkg');
    if (wasm.default) {
      await wasm.default();
    }
    await wasm.init_storage();
    wasmModule = wasm;
    console.log('WASM module initialized successfully');
    return wasm;
  } catch (error) {
    console.error('Failed to initialize WASM module:', error);
    return createUnavailableModule();
  }
}

export function getWasmModule() {
  return wasmModule;
}

// A stale-but-visible tab can't be reloaded out from under someone, and
// neither can one mid-Smart-Parse-scan even while hidden (see
// version-check.js's own doc comment on why), so the only way to close
// that gap is to tell them -- otherwise a deploy that landed while their
// tab stayed open and focused is invisible to them indefinitely, not just
// for the ten minutes GitHub Pages caches HTML for. This runs before
// React mounts, so the event carries the news to whichever component
// ends up listening rather than assuming one exists yet.
function notifyStaleVersion(buildId) {
  window.dispatchEvent(new CustomEvent('bp:stale-version', { detail: { buildId } }));
}

async function main() {
  // `?debug=1` skips the real app entirely -- Safari's remote Web
  // Inspector needs a Mac and a cable, which isn't always at hand right
  // after a real-device repro. This reads the same localStorage record
  // straight from a phone with nothing else, no wasm/version-check
  // startup cost paid for a view that's just reading one stored value.
  if (new URLSearchParams(window.location.search).get('debug') === '1') {
    const container = document.getElementById('root');
    createRoot(container).render(<DebugPanel />);
    return;
  }

  // Convenience only -- the record in localStorage is what actually
  // matters (see receiptFailureBreadcrumb.js), since a live console isn't
  // necessarily attached at the moment this boot happens. Never cleared,
  // so it's still inspectable directly even if nothing logged this.
  const lastFailure = readLastReceiptFailure();
  if (lastFailure) console.log('Last receipt-capture failure:', lastFailure);

  startVersionCheck({ onStale: notifyStaleVersion, isBusy: isActivityInProgress });

  const wasm = await initWasm();
  wasmModule = wasm;

  const container = document.getElementById('root');
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App wasmModule={wasm} />
    </React.StrictMode>,
  );
}

main();
