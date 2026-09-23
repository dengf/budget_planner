import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useMediaQuery from './useMediaQuery';

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

describe('useMediaQuery', () => {
  it('reads the initial matchMedia value', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(max-width: 640px)'));
    expect(result.current).toBe(true);
  });

  it('updates when the media query change event fires', () => {
    const mql = mockMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(max-width: 640px)'));
    expect(result.current).toBe(false);

    act(() => mql.fire(true));
    expect(result.current).toBe(true);

    act(() => mql.fire(false));
    expect(result.current).toBe(false);
  });

  // The whole reason the fallback is a parameter: `useIsDesktop` wants
  // `false` when matchMedia is missing (jsdom), and Header's phone check
  // wants `true` -- both of which mean "render the phone shell".
  it("reports the caller's fallback when matchMedia is unavailable", () => {
    delete window.matchMedia;
    expect(renderHook(() => useMediaQuery('(min-width: 960px)', false)).result.current).toBe(false);
    expect(renderHook(() => useMediaQuery('(max-width: 640px)', true)).result.current).toBe(true);
  });
});
