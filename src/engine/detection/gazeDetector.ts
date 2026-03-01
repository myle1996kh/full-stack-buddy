/**
 * Simplified gaze/attention detector using face brightness regions.
 * Without MediaPipe Face Mesh, we estimate gaze direction from face position.
 */

export interface GazeFrame {
  timestamp: number;
  gazeX: number;   // 0-1
  gazeY: number;   // 0-1
  zone: string;    // 'center', 'top-left', etc.
  faceDetected: boolean;
  faceCenterX: number;
  faceCenterY: number;
}

export class GazeDetector {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private readonly WIDTH = 120;
  private readonly HEIGHT = 90;

  constructor() {
    this.canvas = new OffscreenCanvas(this.WIDTH, this.HEIGHT);
    this.ctx = this.canvas.getContext('2d')!;
  }

  processVideoFrame(video: HTMLVideoElement): GazeFrame {
    this.ctx.drawImage(video, 0, 0, this.WIDTH, this.HEIGHT);
    const frame = this.ctx.getImageData(0, 0, this.WIDTH, this.HEIGHT);

    // Simple face detection: find skin-colored region centroid
    const { detected, cx, cy } = this.detectFaceRegion(frame);

    // Map face position to gaze (assuming looking at camera = center)
    // When face is centered, gaze is center. When face shifts, gaze shifts opposite.
    const gazeX = detected ? 1 - cx : 0.5;
    const gazeY = detected ? cy : 0.5;
    const zone = this.classifyZone(gazeX, gazeY);

    return {
      timestamp: Date.now(),
      gazeX,
      gazeY,
      zone,
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

        // Simple skin color detection (works for various skin tones)
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
    // HSV-based skin detection heuristic
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const diff = max - min;

    if (diff < 15) return false; // too gray
    if (r < 60) return false;   // too dark
    if (r <= g || r <= b) return false; // R should dominate
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
