// Where every in-app link back to meifio itself points. One module so the
// header's byline and anything added later can never drift apart -- see
// meifio-blog's astro.config.mjs for the note on where this moves once the
// blog has its own domain.
//
// This file is identical in mortgage_calculator, budget_planner and
// postcard_maker, and is meant to stay that way. Copy it whole rather than
// editing one in place.
const MEIFIO_HOME = 'https://dengf.github.io/meifio-blog/';

/**
 * The blog's home, in the reader's language.
 *
 * The traffic already runs the other way: meifio-blog carries the reader's
 * locale into each tool as `?lang=`, precisely so someone reading in Chinese
 * is not handed an English app. This is the return leg of the same trip, and
 * it used to drop the locale on the floor -- a byline tapped from the
 * Traditional Chinese app landed on English prose.
 *
 * The blog is a static Astro site, so its locales are path prefixes rather
 * than a query parameter (`/meifio-blog/zh-Hant/`), and English is the
 * unprefixed one. The locale ids are shared with the blog's own
 * `src/i18n/config.ts`, which is what lets this be a concatenation instead of
 * a lookup table that would need updating in two repos at once.
 */
export function meifioHome(locale) {
  return locale && locale !== 'en' ? `${MEIFIO_HOME}${locale}/` : MEIFIO_HOME;
}
