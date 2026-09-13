import React, { useState } from 'react';
import { useI18n } from '../i18n';
import { startRecording, transcribeVoiceCommand } from '../voiceCapture';
import { todayIso } from '../month';
import { MicIcon } from './icons';
import CalcError from './CalcError';
import { beginActivity, endActivity } from '../activityGuard';

/**
 * Turns a `getUserMedia`/`MediaRecorder` failure into a translated
 * sentence. These never reach the wasm boundary, so they can't use the
 * `Message` code+params convention `budget-wasm-voice` itself uses for a
 * model-load or transcription failure -- but the same idea applies: only
 * `NotAllowedError`/`SecurityError` (a real permission denial) gets the
 * permission-specific copy, and anything else surfaces the browser's own
 * `error.name`/`error.message` rather than guessing, since a silently
 * wrong "check your permission" message for e.g. a `MediaRecorder`
 * encoding failure sends someone chasing the wrong fix.
 */
function captureErrorMessage(error, t) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return t('transactions.voiceCaptureFailed');
  }
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    return t('err.microphoneNotFound');
  }
  return t('err.voiceCaptureUnexpected', {
    value: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
  });
}

/**
 * Adds a transaction by voice ("add expense twelve dollars groceries")
 * instead of typing it in. Deliberately does not add anything itself --
 * see `AddTransactionSheet.jsx`'s `onParsed`, which fills the ordinary
 * manual form and switches back to it, so a mis-transcribed word or a
 * missed category is caught by the same review step every other entry
 * method already goes through, and there is exactly one place in this
 * app that ever calls `transactions.save`.
 *
 * Nothing here is uploaded anywhere -- recording, ASR and parsing all run
 * on-device, same privacy promise as receipt OCR. Transcription itself
 * runs in `budget-wasm-voice`'s own lazy wasm module (`voiceCapture.js`),
 * only downloaded the first time this tab actually opens; turning the
 * transcript into a draft (`parse_voice_command`) is a plain-text call on
 * the always-loaded core module, the same split `ReceiptCapture.jsx`
 * draws between OCR and `parse_receipt_text`.
 */
export default function VoiceCapture({ wasmModule, categories, onParsed }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState('idle'); // idle | recording | processing
  const [calcError, setCalcError] = useState(null);
  const [recorder, setRecorder] = useState(null);

  const start = async () => {
    setCalcError(null);
    const handle = startRecording();
    setRecorder(handle);
    setPhase('recording');
    try {
      const samples = await handle.samples;
      setPhase('processing');
      beginActivity();
      const result = await transcribeVoiceCommand(samples);
      if (result?.error) {
        setCalcError(result);
        setPhase('idle');
        return;
      }
      const transcript = result.transcript ?? '';
      const draft = wasmModule.parse_voice_command({
        transcript,
        categories: categories.items,
      });
      onParsed({
        date: todayIso(),
        description: transcript,
        amount: draft.amount != null ? String(draft.amount) : '',
        category_id: draft.category_id ?? '',
        isIncome: draft.is_income ?? false,
      });
      setPhase('idle');
    } catch (error) {
      console.error('Voice capture failed:', error);
      setCalcError({ error: captureErrorMessage(error, t) });
      setPhase('idle');
    } finally {
      setRecorder(null);
      endActivity();
    }
  };

  const stop = () => {
    recorder?.stop();
  };

  return (
    <>
      <h2 className="section-start">{t('transactions.voiceTitle')}</h2>
      <p className="panel-subtitle">{t('transactions.voiceHint')}</p>

      <div className="form-grid">
        {phase === 'idle' && (
          <button type="button" className="btn secondary" onClick={start}>
            <MicIcon />
            {t('transactions.voiceStart')}
          </button>
        )}
        {phase === 'recording' && (
          <button type="button" className="btn voice-recording" onClick={stop}>
            <MicIcon />
            {t('transactions.voiceRecording')}
          </button>
        )}
        {phase === 'processing' && (
          <button type="button" className="btn secondary" disabled>
            <MicIcon />
            {t('transactions.voiceProcessing')}
          </button>
        )}
      </div>

      {calcError && <CalcError result={calcError} />}
    </>
  );
}
