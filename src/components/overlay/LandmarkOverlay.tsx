import { useRef, useEffect, useCallback } from 'react';
import {
  ensureMediaPipe,
  detectPose,
  detectFace,
  drawLandmarks,
  isMediaPipeReady,
  type PoseLandmarkerResult,
  type FaceLandmarkerResult,
} from '@/engine/mediapipe/mediapipeService';

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>;
  active: boolean;
  width?: number;
  height?: number;
  mirrored?: boolean;
  onResults?: (pose: PoseLandmarkerResult | null, face: FaceLandmarkerResult | null) => void;
}

/**
 * Renders a <canvas> overlay that draws MediaPipe landmarks on top of a video element.
 * Must be positioned absolutely over the video container.
 */
export default function LandmarkOverlay({ videoRef, active, width, height, mirrored = true, onResults }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const loadingRef = useRef(false);
  const readyRef = useRef(false);

  // Load MediaPipe models on mount
  useEffect(() => {
    if (loadingRef.current || readyRef.current) return;
    loadingRef.current = true;
    ensureMediaPipe().then(() => {
      readyRef.current = true;
      loadingRef.current = false;
    }).catch((err) => {
      console.warn('MediaPipe failed to load:', err);
      loadingRef.current = false;
    });
  }, []);

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !readyRef.current || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    const w = video.videoWidth || canvas.width;
    const h = video.videoHeight || canvas.height;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    const ts = performance.now();
    const poseResult = detectPose(video, ts);
    const faceResult = detectFace(video, ts);

    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (mirrored) {
        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      drawLandmarks(ctx, w, h, poseResult, faceResult);
      if (mirrored) ctx.restore();
    }

    onResults?.(poseResult, faceResult);
    rafRef.current = requestAnimationFrame(tick);
  }, [videoRef, mirrored, onResults]);

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
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ transform: mirrored ? undefined : undefined }}
    />
  );
}
