import { describe, expect, it } from 'vitest';
import { meifioHome } from './meifioHome';

describe('meifioHome', () => {
  it('sends English to the unprefixed root', () => {
    expect(meifioHome('en')).toBe('https://dengf.github.io/meifio-blog/');
  });

  it('sends each Chinese locale to its own path on the blog', () => {
    expect(meifioHome('zh-Hans')).toBe('https://dengf.github.io/meifio-blog/zh-Hans/');
    expect(meifioHome('zh-Hant')).toBe('https://dengf.github.io/meifio-blog/zh-Hant/');
  });

  it('falls back to the root rather than building a path from nothing', () => {
    // The byline renders before any locale could be missing, but a URL is
    // the wrong place to find out: `/meifio-blog/undefined/` is a 404, and a
    // 404 on the one link out of the app is worse than an English page.
    expect(meifioHome(undefined)).toBe('https://dengf.github.io/meifio-blog/');
    expect(meifioHome('')).toBe('https://dengf.github.io/meifio-blog/');
  });

  it('keeps a trailing slash, which the blog needs', () => {
    // meifio-blog sets `trailingSlash: 'always'` in astro.config.mjs, so a
    // path without one is a redirect at best.
    for (const locale of ['en', 'zh-Hans', 'zh-Hant']) {
      expect(meifioHome(locale).endsWith('/')).toBe(true);
    }
  });
});
