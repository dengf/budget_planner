import React, { useState } from 'react';
import { readLastReceiptFailure } from '../receiptFailureBreadcrumb';

/**
 * `?debug=1` gets you here instead of the normal app -- see index.js. Reads
 * whatever `receiptFailureBreadcrumb.js` last wrote from *any* prior visit
 * to this origin (localStorage, not this page load), so it works from a
 * fresh tab after a crash/reload with no live devtools connection at all --
 * the one real diagnostic path when there's no Mac around for Safari's
 * remote Web Inspector.
 */
export default function DebugPanel() {
  const [copied, setCopied] = useState(false);
  const failure = readLastReceiptFailure();
  const json = failure ? JSON.stringify(failure, null, 2) : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
    } catch {
      // Clipboard permission denied, or unavailable -- the text is still
      // right there to read or screenshot, so this is a nicety only.
    }
  };

  return (
    <div className="debug-panel">
      <h1>Last receipt-extraction failure</h1>
      {json ? (
        <>
          <pre className="debug-panel-json">{json}</pre>
          <button className="btn secondary" onClick={copy}>
            {copied ? 'Copied' : 'Copy to clipboard'}
          </button>
        </>
      ) : (
        <p className="debug-panel-empty">Nothing recorded yet.</p>
      )}
    </div>
  );
}
