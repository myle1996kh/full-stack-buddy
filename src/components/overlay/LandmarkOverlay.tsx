import { useRef, useEffect, useCallback } from 'react';
import {
  ensureMediaPipe,
  detectPose,
  detectFace,
  drawLandmarks,
  getMediaPipeInitStatus,
  type PoseLandmarkerResult,
  type FaceLandmarkerResult,
  type MediaPipeInitStatus,
} from '@/engine/mediapipe/mediapipeService';

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>;
  active: boolean;
  width?: number;
  height?: number;
  mirrored?: boolean;
  onResults?: (pose: PoseLandmarkerResult | null, face: FaceLandmarkerResult | null) => void;
  onStatusChange?: (status: MediaPipeInitStatus) => void;
}

/**
 * Renders a <canvas> overlay that draws MediaPipe landmarks on top of a video element.
 * Must be positioned absolutely over the video container.
 */
export default function LandmarkOverlay({ videoRef, active, width, height, mirrored = true, onResults, onStatusChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const loadingRef = useRef(false);
  const readyRef = useRef(false);

  // Load MediaPipe models on mount (with retry)
  useEffect(() => {
    let cancelled = false;

    const tryLoad = () => {
      if (loadingRef.current || readyRef.current || cancelled) return;
      loadingRef.current = true;
      ensureMediaPipe()
        .then(() => {
          if (!cancelled) readyRef.current = true;
        })
        .catch((err) => {
          console.warn('MediaPipe failed to load:', err);
        })
        .finally(() => {
          loadingRef.current = false;
        });
    };

    tryLoad();
    const retryId = window.setInterval(() => {
      if (!readyRef.current) tryLoad();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(retryId);
    };
  }, []);

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    const w = video.videoWidth || canvas.width;
    const h = video.videoHeight || canvas.height;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    if (!readyRef.current) {
      const status = getMediaPipeInitStatus();
      onStatusChange?.(status);

      const stageLabel: Record<string, string> = {
        idle: 'Waiting to initialize MediaPipe…',
        'loading-fileset': 'Loading MediaPipe fileset…',
        'loading-pose-model': 'Loading Pose model…',
        'loading-face-model': 'Loading Face model…',
        ready: 'MediaPipe ready',
        error: 'MediaPipe init failed',
      };

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'hsla(215, 14%, 50%, 0.9)';
      ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(stageLabel[status.stage] ?? 'MediaPipe loading…', 12, 20);

      if (status.error) {
        ctx.fillStyle = 'hsla(0, 84%, 60%, 0.9)';
        ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText('Check console for model/network error details', 12, 38);
      }

      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    const ts = performance.now();
    const poseResult = detectPose(video, ts);
    const faceResult = detectFace(video, ts);

    if (mirrored) {
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    drawLandmarks(ctx, w, h, poseResult, faceResult);

    const hasPose = Boolean(poseResult?.landmarks?.length);
    const hasFace = Boolean(faceResult?.faceLandmarks?.length);
    if (!hasPose && !hasFace) {
      ctx.fillStyle = 'hsla(215, 14%, 50%, 0.9)';
      ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText('No pose/face detected yet', 12, 20);
    }

    if (mirrored) ctx.restore();

    onStatusChange?.(getMediaPipeInitStatus());
    onResults?.(poseResult, faceResult);
    rafRef.current = requestAnimationFrame(tick);
  }, [videoRef, mirrored, onResults, onStatusChange]);

  useEffect(() => {
    if (active) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active, tick]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-10 w-full h-full pointer-events-none"
      style={{ transform: mirrored ? undefined : undefined }}
    />
  );
}
