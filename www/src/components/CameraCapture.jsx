import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { CameraIcon } from './icons';

/**
 * "Take a photo" that actually takes a photo, in-page, rather than
 * handing off to whatever `<input type="file" capture>` happens to
 * decide on a given browser -- that attribute is only a hint, and on
 * several real devices it opened the photo library or a generic file
 * chooser instead of the camera, which is exactly the confusing
 * mismatch this replaces.
 *
 * `getUserMedia` needs a secure context (HTTPS or localhost) and a
 * camera to grant; either can fail (desktop with no camera, permission
 * denied, an older browser). On any failure this falls back to the
 * plain file input silently -- a photo can still be picked, it just
 * isn't a live camera. There is no dead end.
 */
export default function CameraCapture({ onFile }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState('idle'); // idle | starting | live
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fallbackInputRef = useRef(null);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => stopStream, []); // release the camera if this unmounts while live

  useEffect(() => {
    if (phase === 'live' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [phase]);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      fallbackInputRef.current?.click();
      return;
    }
    setPhase('starting');
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      setPhase('live');
    } catch {
      setPhase('idle');
      fallbackInputRef.current?.click();
    }
  };

  const cancel = () => {
    stopStream();
    setPhase('idle');
  };

  const capture = () => {
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    stopStream();
    setPhase('idle');
    canvas.toBlob(
      (blob) => blob && onFile(new File([blob], 'receipt.jpg', { type: 'image/jpeg' })),
      'image/jpeg',
      0.92,
    );
  };

  const onFallbackFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onFile(file);
  };

  if (phase === 'live') {
    return (
      <div className="camera-live">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a live viewfinder, not recorded media */}
        <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
        <div className="camera-controls">
          <button type="button" className="btn secondary" onClick={cancel}>
            {t('confirm.cancel')}
          </button>
          <button type="button" className="btn camera-shutter" onClick={capture} aria-label={t('transactions.takePhoto')} />
        </div>
      </div>
    );
  }

  return (
    <>
      <button type="button" className="btn secondary" onClick={start} disabled={phase === 'starting'}>
        <CameraIcon />
        {phase === 'starting' ? t('transactions.cameraStarting') : t('transactions.takePhoto')}
      </button>
      {/* Out of flow (see .visually-hidden), so it isn't a grid item
          itself and can't disturb the button's placement above. */}
      <input
        ref={fallbackInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFallbackFile}
        className="visually-hidden"
        tabIndex={-1}
      />
    </>
  );
}
