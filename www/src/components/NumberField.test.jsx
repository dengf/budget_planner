import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import NumberField from './NumberField';

// NumberField is a controlled input: typing into it while `value` stays
// fixed (as a bare mock onChange would leave it) produces garbled
// intermediate values, since React resets the DOM value back to the fixed
// prop after every keystroke. This harness re-renders with the latest
// value, like the real parent components do, while still recording every
// onChange call for assertions.
function ControlledHarness({ initialValue, onChange, ...props }) {
  const [value, setValue] = useState(initialValue);
  return (
    <NumberField
      {...props}
      value={value}
      onChange={(v) => {
        onChange(v);
        setValue(v);
      }}
    />
  );
}

describe('NumberField', () => {
  it('renders the label, value, and suffix', () => {
    render(<NumberField label="Home loan amount" value={400000} onChange={() => {}} suffix="$" />);

    expect(screen.getByText('Home loan amount')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton')).toHaveValue(400000);
    expect(screen.getByText('$')).toBeInTheDocument();
  });

  it('calls onChange with a Number, not the raw string, when edited', async () => {
    const onChange = vi.fn();
    render(<ControlledHarness label="Interest rate" initialValue={6.5} onChange={onChange} />);

    const input = screen.getByRole('spinbutton');
    await userEvent.clear(input);
    await userEvent.type(input, '7.25');

    // The last call reflects the fully-typed value.
    const lastCall = onChange.mock.calls.at(-1);
    expect(lastCall[0]).toBe(7.25);
    expect(typeof lastCall[0]).toBe('number');
  });

  it('reports an empty string rather than NaN when the field is cleared', async () => {
    const onChange = vi.fn();
    render(<NumberField label="Loan term" value={30} onChange={onChange} />);

    await userEvent.clear(screen.getByRole('spinbutton'));

    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('does not render a suffix element when none is given', () => {
    render(<NumberField label="Loan term" value={30} onChange={() => {}} />);
    expect(screen.queryByText('years')).not.toBeInTheDocument();
  });
});

describe('NumberField grouped money display', () => {
  function Controlled({ initial = 500000, ...rest }) {
    const [v, setV] = React.useState(initial);
    return (
      <NumberField label="Home price" value={v} onChange={setV} suffix="$" grouped {...rest} />
    );
  }

  it('shows separators at rest, which is when the figure is read', () => {
    render(<Controlled />);
    expect(screen.getByDisplayValue('500,000')).toBeInTheDocument();
  });

  it('drops to plain digits on focus so the caret is never repositioned', async () => {
    render(<Controlled />);
    const input = screen.getByDisplayValue('500,000');
    await userEvent.click(input);
    expect(input).toHaveValue('500000');
  });

  it('regroups on blur', async () => {
    render(<Controlled />);
    const input = screen.getByDisplayValue('500,000');
    await userEvent.click(input);
    await userEvent.tab();
    expect(input).toHaveValue('500,000');
  });

  it('parses a value typed with separators', async () => {
    // Controlled with real state: with a fixed `value` prop the input can
    // never accumulate keystrokes, and the assertion would pass against a
    // component that does nothing.
    const seen = [];
    function Spy() {
      const [v, setV] = React.useState('');
      return (
        <NumberField
          label="Home price"
          value={v}
          suffix="$"
          grouped
          onChange={(next) => {
            seen.push(next);
            setV(next);
          }}
        />
      );
    }
    render(<Spy />);
    await userEvent.type(screen.getByRole('textbox'), '1,250,000');
    // Number('1,250,000') is NaN — separators have to be stripped first.
    expect(seen.at(-1)).toBe(1250000);
  });

  it('never lets a non-numeric character reach the binding', async () => {
    const seen = [];
    function Spy() {
      const [v, setV] = React.useState('');
      return (
        <NumberField
          label="Home price"
          value={v}
          suffix="$"
          grouped
          onChange={(next) => {
            seen.push(next);
            setV(next);
          }}
        />
      );
    }
    render(<Spy />);
    await userEvent.type(screen.getByRole('textbox'), '12ab34');
    // The letters are dropped; the digits around them still land.
    expect(seen.every((v) => v === '' || Number.isFinite(v))).toBe(true);
    expect(seen.at(-1)).toBe(1234);
  });

  it('leaves non-money fields as plain number inputs', () => {
    render(<NumberField label="Interest rate" value={6.5} onChange={() => {}} suffix="%" />);
    expect(screen.getByDisplayValue('6.5')).toHaveAttribute('type', 'number');
  });
});
