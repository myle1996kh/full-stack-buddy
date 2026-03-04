/**
 * Offline file processor for Module Test Lab.
 * Processes uploaded audio/video files into typed frames
 * compatible with MSE module extract() and compare() functions.
 */

import type { SoundFrame, EyesFrame, MotionFrame as ModuleMotionFrame } from '@/types/modules';
import { MotionDetector } from '@/engine/detection/motionDetector';
import { GazeDetector } from '@/engine/detection/gazeDetector';
import { ensureMediaPipe } from '@/engine/mediapipe/mediapipeService';

// ── Audio Processing ──

/**
 * Process an audio or video file and extract SoundFrames.
 * Uses OfflineAudioContext to decode and analyze the audio track.
 */
export async function processAudioFile(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<SoundFrame[]> {
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  audioCtx.close();

  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0); // mono
  const frames: SoundFrame[] = [];

  // Analyze in windows of ~50ms (20 fps)
  const windowSize = Math.floor(sampleRate * 0.05);
  const hopSize = windowSize; // non-overlapping
  const totalWindows = Math.floor(channelData.length / hopSize);

  for (let w = 0; w < totalWindows; w++) {
    const start = w * hopSize;
    const end = Math.min(start + windowSize, channelData.length);
    const segment = channelData.slice(start, end);

    const volume = computeRMS(segment) * 300; // scale like AudioAnalyzer
    const pitch = detectPitchACF(segment, sampleRate);

    frames.push({
      timestamp: (start / sampleRate) * 1000, // ms
      pitch,
      volume: Math.min(100, volume),
    });

    if (onProgress && w % 50 === 0) {
      onProgress((w / totalWindows) * 100);
    }
  }

  return frames;
}

function computeRMS(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

function detectPitchACF(data: Float32Array, sampleRate: number): number {
  const rms = computeRMS(data);
  if (rms < 0.01) return 0;

  const minLag = Math.floor(sampleRate / 500);
  const maxLag = Math.min(Math.floor(sampleRate / 80), data.length - 1);

  let bestCorr = 0;
  let bestLag = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < data.length - lag; i++) {
      corr += data[i] * data[i + lag];
    }
    corr /= (data.length - lag);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestCorr < 0.01 || bestLag === 0) return 0;
  return Math.round(sampleRate / bestLag);
}

// ── Video Processing for Motion ──

/**
 * Process a video file and extract MotionFrames using canvas frame differencing.
 * Seeks through the video at regular intervals.
 */
export async function processVideoForMotion(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<ModuleMotionFrame[]> {
  const video = await createVideoElement(file);
  const detector = new MotionDetector();
  const frames: ModuleMotionFrame[] = [];

  const duration = video.duration;
  const fps = 10; // sample at 10fps for efficiency
  const interval = 1 / fps;
  const totalFrames = Math.floor(duration * fps);

  for (let i = 0; i < totalFrames; i++) {
    const time = i * interval;
    await seekTo(video, time);

    const motionFrame = detector.processVideoFrame(video);

    // Map to module's MotionFrame type
    frames.push({
      timestamp: time * 1000,
      // No MediaPipe landmarks for pure motion detection
      // but we store motion data as pseudo-landmarks for pattern extraction
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
 * This is slower but provides real skeleton data for pose comparison.
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
  const fps = 5; // MediaPipe is heavy — 5fps
  const interval = 1 / fps;
  const totalFrames = Math.floor(duration * fps);

  for (let i = 0; i < totalFrames; i++) {
    const time = i * interval;
    await seekTo(video, time);

    const ts = time * 1000;
    const poseResult = detectPose(video, ts);

    const landmarks = poseResult?.landmarks?.[0]?.map(lm => [lm.x, lm.y, lm.z]) || undefined;

    frames.push({
      timestamp: ts,
      landmarks,
    });

    if (onProgress && i % 3 === 0) {
      onProgress((i / totalFrames) * 100);
    }
  }

  cleanup(video);
  return frames;
}

// ── Video Processing for Eyes ──

/**
 * Process a video file and extract EyesFrames using MediaPipe face detection.
 */
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
      blinkDetected: false, // blink detection requires temporal analysis
    });

    if (onProgress && i % 3 === 0) {
      onProgress((i / totalFrames) * 100);
    }
  }

  cleanup(video);
  return frames;
}

// ── Video Processing for Sound (from video file) ──

/**
 * Extract audio from a video file and process as SoundFrames.
 */
export async function processVideoForSound(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<SoundFrame[]> {
  // Video files can be decoded the same way — Web Audio handles both
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

    // Style off-screen but still rendered (MediaPipe needs visible frames)
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
      // Small delay to ensure frame is rendered
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
