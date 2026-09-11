import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, afterEach } from 'vitest';
import DebugPanel from './DebugPanel';
import * as breadcrumb from '../receiptFailureBreadcrumb';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DebugPanel', () => {
  it('shows a placeholder when nothing has been recorded', () => {
    vi.spyOn(breadcrumb, 'readLastReceiptFailure').mockReturnValue(null);

    render(<DebugPanel />);

    expect(screen.getByText('Nothing recorded yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the recorded failure as readable JSON', () => {
    vi.spyOn(breadcrumb, 'readLastReceiptFailure').mockReturnValue({
      message: 'boom',
      progressPhase: 'download',
      progressLoadedBytes: 12345,
      smartParseEnabled: true,
      hiddenAtFailure: true,
      timestamp: '2026-09-11T00:00:00.000Z',
    });

    render(<DebugPanel />);

    expect(screen.getByText(/"message": "boom"/)).toBeInTheDocument();
    expect(screen.getByText(/"progressLoadedBytes": 12345/)).toBeInTheDocument();
  });

  it('copies the JSON to the clipboard on request', async () => {
    vi.spyOn(breadcrumb, 'readLastReceiptFailure').mockReturnValue({ message: 'boom' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<DebugPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});
