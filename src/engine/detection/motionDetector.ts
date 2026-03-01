/**
 * Canvas-based motion detector using frame differencing.
 * Works without MediaPipe — just needs camera frames drawn to a canvas.
 */

export interface MotionFrame {
  timestamp: number;
  motionLevel: number;     // 0-1 overall motion intensity
  regionMotion: number[];  // 9 regions (3x3 grid) motion levels
  centroidX: number;       // 0-1 center of motion X
  centroidY: number;       // 0-1 center of motion Y
}

export class MotionDetector {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private prevFrame: ImageData | null = null;
  private readonly WIDTH = 160;
  private readonly HEIGHT = 120;

  constructor() {
    this.canvas = new OffscreenCanvas(this.WIDTH, this.HEIGHT);
    this.ctx = this.canvas.getContext('2d')!;
  }

  processVideoFrame(video: HTMLVideoElement): MotionFrame {
    this.ctx.drawImage(video, 0, 0, this.WIDTH, this.HEIGHT);
    const currentFrame = this.ctx.getImageData(0, 0, this.WIDTH, this.HEIGHT);

    if (!this.prevFrame) {
      this.prevFrame = currentFrame;
      return {
        timestamp: Date.now(),
        motionLevel: 0,
        regionMotion: new Array(9).fill(0),
        centroidX: 0.5,
        centroidY: 0.5,
      };
    }

    const { motionLevel, regionMotion, centroidX, centroidY } = this.computeFrameDiff(
      this.prevFrame, currentFrame
    );

    this.prevFrame = currentFrame;

    return {
      timestamp: Date.now(),
      motionLevel,
      regionMotion,
      centroidX,
      centroidY,
    };
  }

  private computeFrameDiff(prev: ImageData, curr: ImageData) {
    const w = this.WIDTH;
    const h = this.HEIGHT;
    const regionW = Math.floor(w / 3);
    const regionH = Math.floor(h / 3);

    const regionMotion = new Array(9).fill(0);
    const regionPixels = new Array(9).fill(0);

    let totalDiff = 0;
    let weightedX = 0;
    let weightedY = 0;
    let totalWeight = 0;
    let pixelCount = 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const dr = Math.abs(curr.data[i] - prev.data[i]);
        const dg = Math.abs(curr.data[i + 1] - prev.data[i + 1]);
        const db = Math.abs(curr.data[i + 2] - prev.data[i + 2]);
        const diff = (dr + dg + db) / 3;

        if (diff > 15) { // threshold to ignore noise
          totalDiff += diff;
          weightedX += x * diff;
          weightedY += y * diff;
          totalWeight += diff;
          pixelCount++;

          const rx = Math.min(2, Math.floor(x / regionW));
          const ry = Math.min(2, Math.floor(y / regionH));
          const ri = ry * 3 + rx;
          regionMotion[ri] += diff;
          regionPixels[ri]++;
        }
      }
    }

    const totalPixels = w * h;
    const motionLevel = Math.min(1, (pixelCount / totalPixels) * 5); // amplify

    // Normalize region motion
    for (let i = 0; i < 9; i++) {
      const regionTotal = regionW * regionH;
      regionMotion[i] = regionPixels[i] > 0
        ? Math.min(1, (regionPixels[i] / regionTotal) * 5)
        : 0;
    }

    const centroidX = totalWeight > 0 ? (weightedX / totalWeight) / w : 0.5;
    const centroidY = totalWeight > 0 ? (weightedY / totalWeight) / h : 0.5;

    return { motionLevel, regionMotion, centroidX, centroidY };
  }

  reset(): void {
    this.prevFrame = null;
  }
}
