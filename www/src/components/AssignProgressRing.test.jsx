import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AssignProgressRing from './AssignProgressRing';

const CIRCUMFERENCE = 2 * Math.PI * 24;

describe('AssignProgressRing', () => {
  it('applies the state as a modifier class', () => {
    const { container } = render(<AssignProgressRing fraction={0.5} state="over" />);
    expect(container.querySelector('svg').classList).toContain('assign-progress-ring-over');
  });

  it('clamps a fraction above 1 so the ring never draws past full', () => {
    const { container } = render(<AssignProgressRing fraction={1.5} state="over" />);
    const fill = container.querySelector('.ring-fill');
    expect(Number(fill.getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 5);
  });

  it('clamps a negative fraction to a fully empty ring', () => {
    const { container } = render(<AssignProgressRing fraction={-0.3} state="start" />);
    const fill = container.querySelector('.ring-fill');
    expect(Number(fill.getAttribute('stroke-dashoffset'))).toBeCloseTo(CIRCUMFERENCE, 5);
  });

  it('is decorative -- the adjacent assign-label text carries the meaning', () => {
    const { container } = render(<AssignProgressRing fraction={0.5} state="onTrack" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
