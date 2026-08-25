/**
 * Composing a mail-client link for a finished report.
 *
 * Nothing is sent from here. The app is a static site that promises
 * nothing you type is sent anywhere, and it keeps that promise by handing
 * the message to the reader's own mail client and stepping back — the
 * recipients, the text, and the decision to send are all theirs.
 *
 * A `mailto:` link cannot carry an attachment. That is a limitation of the
 * scheme, not an oversight: the PDF is saved from the print dialog and
 * attached by hand, and the body says so rather than leaving the reader to
 * wonder where the document went.
 */

/** Addresses as typed — separated by commas, semicolons or spaces. */
export function parseRecipients(input) {
  return String(input ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Whether an address is worth handing to a mail client.
 *
 * Deliberately permissive: this is not validating an address, it is
 * catching a typo before the mail client silently drops it. Real address
 * syntax is far wider than any regexp anyone actually wants to write, and
 * rejecting a valid address is worse than passing an invalid one through
 * to a client that will say so itself.
 */
export function looksLikeAddress(address) {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(address);
}

/**
 * The `mailto:` URL for a report.
 *
 * RFC 6068: the recipient list is comma-separated, and everything else is
 * percent-encoded. Semicolons — which plenty of people type out of habit,
 * and which some clients accept — are normalized to commas on the way in.
 */
export function mailtoUrl({ recipients, subject, body }) {
  const to = parseRecipients(recipients).map(encodeURIComponent).join(',');
  const query = [
    subject && `subject=${encodeURIComponent(subject)}`,
    body && `body=${encodeURIComponent(body)}`,
  ]
    .filter(Boolean)
    .join('&');

  return `mailto:${to}${query ? `?${query}` : ''}`;
}
