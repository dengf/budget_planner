import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useIsDesktop from './useIsDesktop';

function mockMatchMedia(initialMatches) {
  let listener;
  const mql = {
    matches: initialMatches,
    addEventListener: (event, cb) => {
      if (event === 'change') listener = cb;
    },
    removeEventListener: vi.fn(),
  };
  window.matchMedia = vi.fn(() => mql);
  return {
    fire(matches) {
      mql.matches = matches;
      listener?.({ matches });
    },
  };
}

afterEach(() => {
  delete window.matchMedia;
});

describe('useIsDesktop', () => {
  it('reads the initial matchMedia value', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
  });

  it('updates when the media query change event fires', () => {
    const mql = mockMatchMedia(false);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);

    act(() => mql.fire(true));
    expect(result.current).toBe(true);

    act(() => mql.fire(false));
    expect(result.current).toBe(false);
  });

  it('defaults to false when matchMedia is unavailable, same as jsdom everywhere else in this suite', () => {
    delete window.matchMedia;
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
  });
});
