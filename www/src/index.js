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

async function main() {
  startVersionCheck();

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
