import { describe, expect, it } from 'vitest';
import { looksLikeAddress, mailtoUrl, parseRecipients } from './mailto';

describe('recipients as people actually type them', () => {
  it('accepts a comma-separated list', () => {
    expect(parseRecipients('a@x.com, b@y.com')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('accepts semicolons, which plenty of clients taught people to use', () => {
    expect(parseRecipients('a@x.com; b@y.com')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('ignores stray separators rather than producing empty recipients', () => {
    expect(parseRecipients(' , a@x.com ,, ')).toEqual(['a@x.com']);
  });

  it('is empty for nothing at all', () => {
    expect(parseRecipients(undefined)).toEqual([]);
    expect(parseRecipients('')).toEqual([]);
  });
});

describe('catching a typo without pretending to validate an address', () => {
  it('passes an ordinary address', () => {
    expect(looksLikeAddress('someone@example.com')).toBe(true);
  });

  it('catches the mistakes worth catching', () => {
    expect(looksLikeAddress('someone')).toBe(false);
    expect(looksLikeAddress('someone@example')).toBe(false);
    expect(looksLikeAddress('two@addresses@example.com')).toBe(false);
  });
});

describe('the link handed to the mail client', () => {
  it('carries every recipient, comma-separated as RFC 6068 wants', () => {
    const url = mailtoUrl({ recipients: 'a@x.com; b@y.com', subject: 'S', body: 'B' });
    expect(url.startsWith('mailto:a%40x.com,b%40y.com?')).toBe(true);
  });

  it('encodes a subject and body that contain the things reports contain', () => {
    // Ampersands, line breaks and currency all break a naively built URL,
    // and a broken one opens a blank message with no explanation.
    const url = mailtoUrl({
      recipients: 'a@x.com',
      subject: 'Illustration & schedule',
      body: 'S$1,584.75\nthen S$1,637.12',
    });

    expect(url).toContain('subject=Illustration%20%26%20schedule');
    expect(url).toContain('%0A');
    expect(url.split('?')[1].split('&').length).toBe(2);
  });

  it('still opens a blank message when nobody is addressed yet', () => {
    expect(mailtoUrl({ recipients: '', subject: 'S' })).toBe('mailto:?subject=S');
  });
});
