import { useRef, useCallback, useState } from 'react';
import { MSEDetector, type MSEFrame, type MSEPattern } from '@/engine/detection/mseDetector';

export interface UseCameraOptions {
  onFrame?: (frame: MSEFrame) => void;
}

export function useCamera(options?: UseCameraOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<MSEDetector | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [active, setActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 720 },
          height: { ideal: 1280 },
          aspectRatio: { ideal: 9 / 16 },
        },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
      return stream;
    } catch (err) {
      console.error('Camera access denied:', err);
      throw err;
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  const startDetection = useCallback(async () => {
    if (!streamRef.current || !videoRef.current) return;
    const detector = new MSEDetector();
    await detector.init(streamRef.current, videoRef.current);
    detectorRef.current = detector;
    detector.start(options?.onFrame);
    setDetecting(true);
  }, [options?.onFrame]);

  const stopDetection = useCallback((): MSEFrame[] => {
    const frames = detectorRef.current?.stop() || [];
    setDetecting(false);
    return frames;
  }, []);

  const extractPattern = useCallback(async (): Promise<MSEPattern | null> => {
    return (await detectorRef.current?.extractPattern()) || null;
  }, []);

  const startRecording = useCallback(() => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const recorder = new MediaRecorder(streamRef.current, {
      mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm',
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start(1000);
    recorderRef.current = recorder;
    setRecording(true);
    setElapsed(0);
    intervalRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
  }, []);

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob(chunksRef.current, { type: 'video/webm' }));
        setRecording(false);
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        setRecording(false);
        resolve(blob);
      };
      recorder.stop();
    });
  }, []);

  const destroy = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    detectorRef.current?.destroy();
    stopCamera();
  }, [stopCamera]);

  return {
    videoRef,
    active,
    recording,
    detecting,
    elapsed,
    startCamera,
    stopCamera,
    startDetection,
    stopDetection,
    startRecording,
    stopRecording,
    extractPattern,
    destroy,
    getLatestFrame: () => detectorRef.current?.getLatestFrame() || null,
  };
}
