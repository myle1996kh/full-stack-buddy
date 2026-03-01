/**
 * Gaze detector using MediaPipe FaceLandmarker iris tracking.
 * Falls back to skin-color heuristic if MediaPipe is unavailable.
 */

import { detectFace, ensureMediaPipe, isMediaPipeReady } from '@/engine/mediapipe/mediapipeService';

export interface GazeFrame {
  timestamp: number;
  gazeX: number;   // 0-1
  gazeY: number;   // 0-1
  zone: string;    // 'center', 'top-left', etc.
  faceDetected: boolean;
  faceCenterX: number;
  faceCenterY: number;
}

// MediaPipe FaceLandmarker iris indices
// Left iris: 468-472 (468 = center), Right iris: 473-477 (473 = center)
const LEFT_IRIS_CENTER = 468;
const RIGHT_IRIS_CENTER = 473;
// Eye corner landmarks for computing relative gaze
const LEFT_EYE_INNER = 133;
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_OUTER = 263;
const LEFT_EYE_TOP = 159;
const LEFT_EYE_BOTTOM = 145;
const RIGHT_EYE_TOP = 386;
const RIGHT_EYE_BOTTOM = 374;
// Nose tip for face center
const NOSE_TIP = 1;

export class GazeDetector {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private readonly WIDTH = 120;
  private readonly HEIGHT = 90;
  private mediaPipeLoading = false;

  constructor() {
    this.canvas = new OffscreenCanvas(this.WIDTH, this.HEIGHT);
    this.ctx = this.canvas.getContext('2d')!;
    // Kick off MediaPipe load (non-blocking)
    if (!this.mediaPipeLoading) {
      this.mediaPipeLoading = true;
      ensureMediaPipe().catch(() => {});
    }
  }

  processVideoFrame(video: HTMLVideoElement): GazeFrame {
    // Try MediaPipe iris tracking first
    if (isMediaPipeReady()) {
      const result = this.processWithMediaPipe(video);
      if (result) return result;
    }

    // Fallback to skin-color heuristic
    return this.processWithHeuristic(video);
  }

  private processWithMediaPipe(video: HTMLVideoElement): GazeFrame | null {
    try {
      const faceResult = detectFace(video, performance.now());
      if (!faceResult?.faceLandmarks?.length) return null;

      const lm = faceResult.faceLandmarks[0];
      if (lm.length < 478) return null; // Need iris landmarks

      // Get iris centers
      const leftIris = lm[LEFT_IRIS_CENTER];
      const rightIris = lm[RIGHT_IRIS_CENTER];

      // Get eye boundaries for relative iris position
      const leftGaze = this.computeIrisRatio(
        lm[LEFT_EYE_INNER], lm[LEFT_EYE_OUTER],
        lm[LEFT_EYE_TOP], lm[LEFT_EYE_BOTTOM],
        leftIris
      );
      const rightGaze = this.computeIrisRatio(
        lm[RIGHT_EYE_INNER], lm[RIGHT_EYE_OUTER],
        lm[RIGHT_EYE_TOP], lm[RIGHT_EYE_BOTTOM],
        rightIris
      );

      // Average both eyes for gaze direction
      const gazeX = (leftGaze.x + rightGaze.x) / 2;
      const gazeY = (leftGaze.y + rightGaze.y) / 2;

      // Face center from nose tip
      const nose = lm[NOSE_TIP];

      return {
        timestamp: Date.now(),
        gazeX: Math.max(0, Math.min(1, gazeX)),
        gazeY: Math.max(0, Math.min(1, gazeY)),
        zone: this.classifyZone(gazeX, gazeY),
        faceDetected: true,
        faceCenterX: nose.x,
        faceCenterY: nose.y,
      };
    } catch {
      return null;
    }
  }

  /**
   * Compute where the iris sits within the eye opening as a 0-1 ratio.
   * 0 = looking fully in one direction, 1 = looking fully in the other.
   */
  private computeIrisRatio(
    inner: { x: number; y: number },
    outer: { x: number; y: number },
    top: { x: number; y: number },
    bottom: { x: number; y: number },
    iris: { x: number; y: number }
  ): { x: number; y: number } {
    // Horizontal: where is iris between outer and inner corners
    const eyeWidth = Math.abs(inner.x - outer.x);
    const irisFromOuter = Math.abs(iris.x - outer.x);
    const rawX = eyeWidth > 0.001 ? irisFromOuter / eyeWidth : 0.5;

    // Vertical: where is iris between top and bottom
    const eyeHeight = Math.abs(bottom.y - top.y);
    const irisFromTop = Math.abs(iris.y - top.y);
    const rawY = eyeHeight > 0.001 ? irisFromTop / eyeHeight : 0.5;

    // Map to 0-1 with center = 0.5
    // Clamp and smooth — iris usually stays in 0.3-0.7 range
    return {
      x: Math.max(0, Math.min(1, rawX)),
      y: Math.max(0, Math.min(1, rawY)),
    };
  }

  // ── Fallback: skin-color heuristic ──

  private processWithHeuristic(video: HTMLVideoElement): GazeFrame {
    this.ctx.drawImage(video, 0, 0, this.WIDTH, this.HEIGHT);
    const frame = this.ctx.getImageData(0, 0, this.WIDTH, this.HEIGHT);

    const { detected, cx, cy } = this.detectFaceRegion(frame);
    const gazeX = detected ? 1 - cx : 0.5;
    const gazeY = detected ? cy : 0.5;

    return {
      timestamp: Date.now(),
      gazeX,
      gazeY,
      zone: this.classifyZone(gazeX, gazeY),
      faceDetected: detected,
      faceCenterX: cx,
      faceCenterY: cy,
    };
  }

  private detectFaceRegion(frame: ImageData): { detected: boolean; cx: number; cy: number } {
    const w = this.WIDTH;
    const h = this.HEIGHT;
    let totalSkin = 0;
    let sumX = 0;
    let sumY = 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = frame.data[i];
        const g = frame.data[i + 1];
        const b = frame.data[i + 2];

        if (this.isSkinColor(r, g, b)) {
          totalSkin++;
          sumX += x;
          sumY += y;
        }
      }
    }

    const skinRatio = totalSkin / (w * h);
    if (skinRatio < 0.05) {
      return { detected: false, cx: 0.5, cy: 0.5 };
    }

    return {
      detected: true,
      cx: (sumX / totalSkin) / w,
      cy: (sumY / totalSkin) / h,
    };
  }

  private isSkinColor(r: number, g: number, b: number): boolean {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const diff = max - min;
    if (diff < 15) return false;
    if (r < 60) return false;
    if (r <= g || r <= b) return false;
    if (r - g < 15) return false;
    return true;
  }

  private classifyZone(x: number, y: number): string {
    const col = x < 0.33 ? 'left' : x > 0.66 ? 'right' : 'center';
    const row = y < 0.33 ? 'top' : y > 0.66 ? 'bottom' : 'center';
    if (col === 'center' && row === 'center') return 'center';
    return `${row}-${col}`;
  }
}
