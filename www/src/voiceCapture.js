// Records a short voice command from the microphone and runs it through
// `budget-wasm-voice`'s ASR model, entirely on-device -- nothing is
// uploaded anywhere, same privacy promise as every other capture path in
// this app (receipt OCR, PDF extraction). This module's own job is the
// browser I/O nothing else can do: `getUserMedia`/`MediaRecorder` to
// record, and the Web Audio API to decode and resample to the model's
// required 16kHz mono `Float32` samples. Turning the transcript into a
// draft transaction (`parse_voice_command`) is a separate step this
// module does NOT do -- see `VoiceCapture.jsx`, which calls the
// always-loaded core module directly, the same split `receiptCapture.js`
// draws between OCR/PDF extraction and `parse_receipt_text`.
//
// Runs inside `voiceWorker.js`, not here -- see that file's own doc
// comment for why (a multi-ten-megabyte model, its own lazy wasm module).

let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./voiceWorker.js', import.meta.url));
  worker.onmessage = (event) => {
    const { id, ok, result, error } = event.data;
    const call = pending.get(id);
    if (!call) return; // already settled, or from a worker instance we've moved past
    pending.delete(id);
    if (ok) {
      call.resolve(result);
      return;
    }
    call.reject(new Error(error));
  };
  // Same worker-crash fan-out and self-reset as `receiptCapture.js`'s
  // `getWorker` -- see its own doc comment for why.
  worker.onerror = (event) => {
    for (const call of pending.values()) call.reject(new Error(event.message));
    pending.clear();
    worker = null;
  };
  return worker;
}

function callWorker(type, payload, transfer) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, type, ...payload }, transfer);
  });
}

// A voice command here is a single short sentence ("add expense twelve
// dollars groceries"), not dictation -- capping the recording protects
// against someone leaving the mic open, not against a legitimate use.
export const MAX_RECORDING_MS = 12_000;

/**
 * Resamples decoded audio to the model's required 16kHz mono using an
 * `OfflineAudioContext` -- the browser's own resampler, not a hand-rolled
 * one. Connecting a stereo (or any channel count) buffer into a
 * single-channel destination downmixes automatically per the Web Audio
 * spec's default channel-interpretation rules.
 */
async function resampleToMono16k(audioBuffer) {
  const targetRate = 16000;
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(audioBuffer.duration * targetRate),
    targetRate,
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

/**
 * Starts recording from the microphone and returns immediately with a
 * `stop()` you can call when the person taps the mic button again, plus
 * a `samples` promise that resolves to 16kHz mono `Float32` samples once
 * recording actually stops (by `stop()`, by hitting `MAX_RECORDING_MS`,
 * or on its own). `stop()` is safe to call before the microphone
 * permission prompt has even resolved -- it just marks the recording to
 * end the moment it starts, rather than requiring the caller to wait.
 *
 * Throws (via the `samples` promise) if microphone access is denied or
 * unavailable; the caller (`VoiceCapture.jsx`) is responsible for showing
 * that as a recoverable error, not a crash.
 */
// Safari's `MediaRecorder` doesn't reliably pick a working default encoding
// for an audio-only stream the way Chrome/Firefox do -- constructing it with
// no `mimeType` has been observed throwing synchronously on WebKit. Trying
// the codecs it's actually known to support first, and falling back to
// letting the browser choose only if none of them report as supported,
// avoids relying on that implicit default.
const PREFERRED_MIME_TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];

function pickSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function startRecording() {
  let recorder = null;
  let stopRequested = false;

  const samples = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickSupportedMimeType();
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });

    recorder.start();
    if (stopRequested) recorder.stop();
    const timeout = setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, MAX_RECORDING_MS);

    await stopped;
    clearTimeout(timeout);
    for (const track of stream.getTracks()) track.stop();

    const blob = new Blob(chunks, { type: recorder.mimeType });
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    let decoded;
    try {
      decoded = await audioCtx.decodeAudioData(arrayBuffer);
    } finally {
      audioCtx.close();
    }
    return resampleToMono16k(decoded);
  })();

  return {
    stop: () => {
      stopRequested = true;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    },
    samples,
  };
}

/**
 * Runs the ASR model over already-decoded 16kHz mono samples, returning
 * the raw transcript. Empty/silent recordings and model-load failures
 * both surface via `result.error`, mirroring every other worker call in
 * this app (`extractReceiptText`, `classifyStatementDescriptions`) rather
 * than throwing.
 */
export async function transcribeVoiceCommand(samples) {
  return callWorker('transcribe', { samples }, [samples.buffer]);
}
