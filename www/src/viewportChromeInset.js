// iOS Safari doesn't expose how much of the layout viewport its own chrome
// (the bottom toolbar, or an on-screen keyboard) is covering right now --
// `env(safe-area-inset-bottom)` only ever accounts for the home-indicator
// strip on notched devices, not Safari's own toolbar. When that toolbar is
// showing, a `position: fixed; bottom: 0` element can end up with its last
// few rows actually rendered behind it rather than above it -- caught on a
// real device, not in any headless test, the same way main.css's own
// safe-area comment describes the home-indicator case this supersedes.
//
// The Visual Viewport API is the only way to measure the real gap:
// `window.innerHeight` stays the full layout-viewport height while
// `visualViewport.height`/`offsetTop` shrink or shift as chrome appears,
// so the difference between them is exactly what's currently obscured.
export function startViewportChromeInsetTracking(root = document.documentElement) {
  const vv = window.visualViewport;
  if (!vv) return () => {};

  const update = () => {
    // `offsetTop` is clamped at 0 before it is subtracted, and that clamp
    // is the whole point of this line. A *negative* offsetTop means the
    // visual viewport is sitting above the layout viewport -- rubber-band
    // overscroll, or the moment iOS collapses its URL bar mid-scroll --
    // and subtracting a negative number adds to the gap, inventing chrome
    // that isn't there and lifting the bar off the bottom of the screen
    // by however far the page happened to bounce. Nothing re-fires once
    // the bounce settles, so that invented inset is what stays on screen.
    // Only a visual viewport pushed *down* inside the layout viewport
    // means something is covering the bottom edge.
    const gap = window.innerHeight - vv.height - Math.max(0, vv.offsetTop);
    root.style.setProperty('--chrome-inset-bottom', `${Math.max(0, Math.round(gap))}px`);
  };

  update();
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  return () => {
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
  };
}
