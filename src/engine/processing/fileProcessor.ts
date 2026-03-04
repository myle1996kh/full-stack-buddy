/**
 * Offline file processor for Module Test Lab.
 * Processes uploaded audio/video files into typed frames
 * compatible with MSE module extract() and compare() functions.
 */

import type { SoundFrame, EyesFrame, MotionFrame as ModuleMotionFrame } from '@/types/modules';
import { MotionDetector } from '@/engine/detection/motionDetector';
import { GazeDetector } from '@/engine/detection/gazeDetector';
import { ensureMediaPipe } from '@/engine/mediapipe/mediapipeService';
import { processAudioFileV2, extractSoundPatternV2 } from '@/engine/sound/index';
import type { SoundFrameV2 } from '@/engine/sound/types';

// ── Audio Processing (V2 pipeline) ──

/**
 * Process an audio or video file and extract SoundFrames.
 * Uses the V2 pipeline for proper feature extraction.
 * Returns legacy SoundFrame[] for compatibility with module extract().
 */
export async function processAudioFile(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<SoundFrame[]> {
  const { frames, duration, clipping } = await processAudioFileV2(file, onProgress);

  onProgress?.(95);

  // Convert V2 frames to legacy SoundFrame for module compatibility
  return frames.map(f => ({
    timestamp: f.t * 1000, // seconds -> ms
    pitch: f.pitchHz ?? 0,
    volume: f.energyDb > -100 ? Math.min(100, Math.pow(10, f.energyDb / 20) * 100) : 0,
  }));
}

/**
 * Process audio file directly to V2 frames + pattern.
 * Use this for the V2 pipeline (skips legacy conversion).
 */
export async function processAudioFileToV2(
  file: File,
  onProgress?: (pct: number) => void,
) {
  return processAudioFileV2(file, onProgress);
}

// ── Video Processing for Motion ──

/**
 * Process a video file and extract MotionFrames using canvas frame differencing.
 */
export async function processVideoForMotion(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<ModuleMotionFrame[]> {
  const video = await createVideoElement(file);
  const detector = new MotionDetector();
  const frames: ModuleMotionFrame[] = [];

  const duration = video.duration;
  const fps = 10;
  const interval = 1 / fps;
  const totalFrames = Math.floor(duration * fps);

  for (let i = 0; i < totalFrames; i++) {
    const time = i * interval;
    await seekTo(video, time);

    const motionFrame = detector.processVideoFrame(video);

    frames.push({
      timestamp: time * 1000,
      landmarks: motionFrame.regionMotion.map((v, idx) => [
        (idx % 3) / 3, Math.floor(idx / 3) / 3, v,
      ]),
    });

    if (onProgress && i % 5 === 0) {
      onProgress((i / totalFrames) * 100);
    }
  }

  cleanup(video);
  return frames;
}

/**
 * Process a video file and extract MotionFrames WITH MediaPipe pose landmarks.
 */
export async function processVideoForPose(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<ModuleMotionFrame[]> {
  await ensureMediaPipe();
  const { detectPose } = await import('@/engine/mediapipe/mediapipeService');

  const video = await createVideoElement(file);
  const frames: ModuleMotionFrame[] = [];

  const duration = video.duration;
  const fps = 5;
  const interval = 1 / fps;
  const totalFrames = Math.floor(duration * fps);

  for (let i = 0; i < totalFrames; i++) {
    const time = i * interval;
    await seekTo(video, time);

    const ts = time * 1000;
    const poseResult = detectPose(video, ts);
    const landmarks = poseResult?.landmarks?.[0]?.map(lm => [lm.x, lm.y, lm.z]) || undefined;

    frames.push({ timestamp: ts, landmarks });

    if (onProgress && i % 3 === 0) {
      onProgress((i / totalFrames) * 100);
    }
  }

  cleanup(video);
  return frames;
}

// ── Video Processing for Eyes ──

export async function processVideoForEyes(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<EyesFrame[]> {
  await ensureMediaPipe();

  const video = await createVideoElement(file);
  const detector = new GazeDetector();
  const frames: EyesFrame[] = [];

  const duration = video.duration;
  const fps = 5;
  const interval = 1 / fps;
  const totalFrames = Math.floor(duration * fps);

  for (let i = 0; i < totalFrames; i++) {
    const time = i * interval;
    await seekTo(video, time);

    const gazeFrame = detector.processVideoFrame(video);

    frames.push({
      timestamp: time * 1000,
      gazeX: gazeFrame.gazeX,
      gazeY: gazeFrame.gazeY,
      zone: gazeFrame.zone,
      blinkDetected: false,
    });

    if (onProgress && i % 3 === 0) {
      onProgress((i / totalFrames) * 100);
    }
  }

  cleanup(video);
  return frames;
}

// ── Video Processing for Sound (from video file) ──

export async function processVideoForSound(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<SoundFrame[]> {
  return processAudioFile(file, onProgress);
}

// ── Helpers ──

function createVideoElement(file: File): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';

    video.style.position = 'fixed';
    video.style.left = '-9999px';
    video.style.top = '-9999px';
    video.style.width = '640px';
    video.style.height = '480px';
    document.body.appendChild(video);

    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    video.onloadedmetadata = () => {
      video.width = video.videoWidth || 640;
      video.height = video.videoHeight || 480;
      resolve(video);
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      document.body.removeChild(video);
      reject(new Error('Failed to load video file'));
    };
  });
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.01) {
      resolve();
      return;
    }
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      requestAnimationFrame(() => resolve());
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  });
}

function cleanup(video: HTMLVideoElement) {
  const src = video.src;
  video.src = '';
  video.load();
  URL.revokeObjectURL(src);
  if (video.parentNode) {
    video.parentNode.removeChild(video);
  }
}
