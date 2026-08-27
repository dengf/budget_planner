import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startVersionCheck } from './version-check';
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

// A stale-but-visible tab can't be reloaded out from under someone (see
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
  startVersionCheck({ onStale: notifyStaleVersion });

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
