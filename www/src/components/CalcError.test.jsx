import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CalcError from './CalcError';
import { I18nProvider } from '../i18n';

const show = (result, locale = 'en') =>
  render(
    <I18nProvider initialLocale={locale}>
      <CalcError result={result} />
    </I18nProvider>,
  );

describe('CalcError', () => {
  it('prefers the code over the sentence, so the reader gets their language', () => {
    // Four panels rendered `result.error` directly. Rust composes that in
    // English, so a Chinese reader entering a zero term was told about it in
    // English -- in the middle of an otherwise fully translated page.
    show(
      {
        error: "Category name cannot be blank.",
        error_message: { code: 'err.blankCategoryName', params: {} },
      },
      'zh-Hans',
    );

    expect(screen.getByText(/分类名称不能为空/)).toBeInTheDocument();
    expect(screen.queryByText(/Category name cannot be blank/)).not.toBeInTheDocument();
  });

  it('falls back to the sentence when there is no code', () => {
    show({ error: 'something went wrong' });
    expect(screen.getByText('something went wrong')).toBeInTheDocument();
  });

  it('renders nothing when there is no error', () => {
    const { container } = show({ payment: 1234 });
    expect(container).toBeEmptyDOMElement();
    expect(show(null).container).toBeEmptyDOMElement();
  });

  it('reports an unavailable engine in the reader language', () => {
    // What every panel shows when the wasm module could not be loaded.
    show(
      {
        error: 'The calculator engine could not be loaded.',
        error_message: { code: 'err.engineUnavailable', params: {} },
      },
      'zh-Hant',
    );
    expect(screen.getByText(/計算引擎載入失敗/)).toBeInTheDocument();
  });
});
