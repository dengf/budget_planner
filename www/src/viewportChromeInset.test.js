import { afterEach, describe, expect, it } from 'vitest';
import { startViewportChromeInsetTracking } from './viewportChromeInset';

// jsdom has no visualViewport at all, so every test here stands one up --
// the same "the test must supply what the browser would" shape as the
// localStorage fakes elsewhere in this suite.
function fakeVisualViewport({ height, offsetTop = 0 }) {
  const listeners = { resize: [], scroll: [] };
  return {
    height,
    offsetTop,
    addEventListener: (type, fn) => listeners[type].push(fn),
    removeEventListener: (type, fn) => {
      listeners[type] = listeners[type].filter((f) => f !== fn);
    },
    emit: (type) => listeners[type].forEach((fn) => fn()),
    listenerCount: () => listeners.resize.length + listeners.scroll.length,
  };
}

function setUp({ innerHeight, height, offsetTop = 0 }) {
  const vv = fakeVisualViewport({ height, offsetTop });
  window.visualViewport = vv;
  window.innerHeight = innerHeight;
  const root = document.createElement('div');
  const stop = startViewportChromeInsetTracking(root);
  return { vv, root, stop, inset: () => root.style.getPropertyValue('--chrome-inset-bottom') };
}

afterEach(() => {
  delete window.visualViewport;
});

describe('viewport chrome inset', () => {
  it('measures the bottom chrome as the part of the layout viewport nothing can see', () => {
    const { inset, stop } = setUp({ innerHeight: 812, height: 762 });
    expect(inset()).toBe('50px');
    stop();
  });

  it('reports no inset when nothing is covering the bottom', () => {
    const { inset, stop } = setUp({ innerHeight: 812, height: 812 });
    expect(inset()).toBe('0px');
    stop();
  });

  // The shipped bug this guards: on a real iPhone the tab bar sat marooned
  // in the middle of the screen with a large gap beneath it. Scrolling to
  // the very bottom of a tab rubber-bands the visual viewport *above* the
  // layout viewport, making `offsetTop` negative -- and subtracting a
  // negative number added the bounce distance to the inset, lifting the
  // bar by exactly that much. Nothing re-fires when the bounce settles,
  // so the invented inset is what stayed on screen.
  it('invents no inset from a rubber-band bounce at the end of a scroll', () => {
    const { vv, inset, stop } = setUp({ innerHeight: 812, height: 812 });
    expect(inset()).toBe('0px');

    vv.offsetTop = -214;
    vv.emit('scroll');
    expect(inset()).toBe('0px');
    stop();
  });

  it('still measures real chrome while the page is bouncing', () => {
    const { vv, inset, stop } = setUp({ innerHeight: 812, height: 762 });
    vv.offsetTop = -120;
    vv.emit('scroll');
    expect(inset()).toBe('50px');
    stop();
  });

  // A visual viewport pushed *down* inside the layout viewport is the
  // case the subtraction exists for -- an on-screen keyboard scrolling
  // the page up under it -- and that one still counts.
  it('counts a visual viewport pushed down inside the layout viewport', () => {
    const { vv, inset, stop } = setUp({ innerHeight: 812, height: 500 });
    vv.offsetTop = 100;
    vv.emit('scroll');
    expect(inset()).toBe('212px');
    stop();
  });

  it('tracks the bar back down when the chrome goes away', () => {
    const { vv, inset, stop } = setUp({ innerHeight: 812, height: 762 });
    expect(inset()).toBe('50px');
    vv.height = 812;
    vv.emit('resize');
    expect(inset()).toBe('0px');
    stop();
  });

  it('detaches both listeners when stopped', () => {
    const { vv, stop } = setUp({ innerHeight: 812, height: 762 });
    expect(vv.listenerCount()).toBe(2);
    stop();
    expect(vv.listenerCount()).toBe(0);
  });

  it('does nothing at all where the API is missing', () => {
    delete window.visualViewport;
    const root = document.createElement('div');
    const stop = startViewportChromeInsetTracking(root);
    expect(root.style.getPropertyValue('--chrome-inset-bottom')).toBe('');
    expect(() => stop()).not.toThrow();
  });
});
