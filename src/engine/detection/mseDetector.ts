/**
 * Unified MSE Detector that orchestrates motion, sound, and eyes detection.
 * Runs all three detectors on each frame and collects results.
 */

import { AudioAnalyzer, type AudioFrame } from './audioAnalyzer';
import { MotionDetector, type MotionFrame, type PoseLabel } from './motionDetector';
import { GazeDetector, type GazeFrame } from './gazeDetector';
import { SoundClassifier, type SoundEvent } from './soundClassifier';
import { ensureMediaPipe, detectPose } from '@/engine/mediapipe/mediapipeService';
import type { SpectralFeatures, SoundEventLabel } from './audioAnalyzer';

export interface MSEFrame {
  timestamp: number;
  motion: MotionFrame;
  sound: AudioFrame;
  gaze: GazeFrame;
}

export interface PoseSegment {
  pose: PoseLabel;
  startFrame: number;
  endFrame: number;
  frameCount: number;
}

export interface PoseLandmarkSnapshot {
  landmarks: { x: number; y: number; z: number }[];
  pose: PoseLabel;
  frameIndex: number;
}

export interface OnsetEvent {
  frameIndex: number;
  timestamp: number;
  label: SoundEventLabel;
  confidence: 'heuristic' | 'ai';
}

export interface MSEPattern {
  motion: {
    avgMotionLevel: number;
    regionProfile: number[];
    motionTimeline: number[];
    centroidPath: { x: number; y: number }[];
    poseCounts: Record<PoseLabel, number>;
    poseSegments: PoseSegment[];
    totalFrames: number;
    poseSnapshots: PoseLandmarkSnapshot[];
  };
  sound: {
    pitchContour: number[];
    volumeContour: number[];
    avgPitch: number;
    avgVolume: number;
    syllableRate: number;
    // New spectral fingerprint data
    spectralCentroidContour: number[];
    spectralZcrContour: number[];
    spectralRolloffContour: number[];
    avgCentroid: number;
    avgZcr: number;
    // Onset / beat data
    onsetTimestamps: number[];  // relative ms from start
    onsetCount: number;
    beatsPerMinute: number;
    // Event labels
    eventSummary: Record<SoundEventLabel, number>;
    events: SoundEvent[];
  };
  eyes: {
    zoneDwellTimes: Record<string, number>;
    zoneSequence: string[];
    zoneTimeline: { time: number; zone: string }[];
    primaryZone: string;
    faceDetectedRatio: number;
  };
  duration: number;
  frameCount: number;
}

export class MSEDetector {
  private motionDetector = new MotionDetector();
  private audioAnalyzer = new AudioAnalyzer();
  private gazeDetector = new GazeDetector();
  private soundClassifier = new SoundClassifier();
  private frames: MSEFrame[] = [];
  private running = false;
  private animFrameId: number | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private onFrame?: (frame: MSEFrame) => void;
  private mediaPipeReady = false;
  private poseLandmarkBuffer: PoseLandmarkSnapshot[] = [];
  private frameCounter = 0;

  async init(stream: MediaStream, videoEl: HTMLVideoElement): Promise<void> {
    this.videoEl = videoEl;
    await this.audioAnalyzer.init(stream);
    this.frames = [];
    this.poseLandmarkBuffer = [];
    this.frameCounter = 0;
    this.soundClassifier.reset();

    const ready = await Promise.race<boolean>([
      ensureMediaPipe().then(() => true).catch(() => false),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 7000)),
    ]);
    this.mediaPipeReady = ready;

    if (!ready) {
      ensureMediaPipe().then(() => { this.mediaPipeReady = true; }).catch(() => {});
    }
  }

  start(onFrame?: (frame: MSEFrame) => void): void {
    this.running = true;
    this.onFrame = onFrame;
    this.tick();
  }

  stop(): MSEFrame[] {
    this.running = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    return [...this.frames];
  }

  private tick = (): void => {
    if (!this.running || !this.videoEl) return;

    const motion = this.motionDetector.processVideoFrame(this.videoEl);
    const sound = this.audioAnalyzer.getFrame();
    const gaze = this.gazeDetector.processVideoFrame(this.videoEl);

    // Feed sound frame to classifier
    this.soundClassifier.addFrame(sound, this.frameCounter);

    // Capture MediaPipe pose landmarks every 10th frame
    if (this.mediaPipeReady && this.frameCounter % 10 === 0) {
      try {
        const poseResult = detectPose(this.videoEl, performance.now());
        if (poseResult?.landmarks?.length) {
          const lm = poseResult.landmarks[0];
          this.poseLandmarkBuffer.push({
            landmarks: lm.map(l => ({ x: l.x, y: l.y, z: l.z })),
            pose: motion.pose,
            frameIndex: this.frameCounter,
          });
        }
      } catch { /* MediaPipe not ready */ }
    }
    this.frameCounter++;

    const frame: MSEFrame = { timestamp: Date.now(), motion, sound, gaze };
    this.frames.push(frame);
    this.onFrame?.(frame);

    this.animFrameId = requestAnimationFrame(this.tick);
  };

  async extractPattern(): Promise<MSEPattern> {
    // Flush pending AI classifications before extracting
    await this.soundClassifier.flush();
    return this.buildPattern();
  }

  /** Synchronous version for cases where we don't need AI labels */
  extractPatternSync(): MSEPattern {
    return this.buildPattern();
  }

  private buildPattern(): MSEPattern {
    const frames = this.frames;
    if (frames.length === 0) return this.emptyPattern();

    const duration = (frames[frames.length - 1].timestamp - frames[0].timestamp) / 1000;
    const startTime = frames[0].timestamp;

    // Motion pattern
    const motionLevels = frames.map(f => f.motion.motionLevel);
    const avgMotionLevel = motionLevels.reduce((a, b) => a + b, 0) / motionLevels.length;
    const regionProfile = new Array(9).fill(0);
    frames.forEach(f => {
      f.motion.regionMotion.forEach((v, i) => { regionProfile[i] += v; });
    });
    regionProfile.forEach((v, i) => { regionProfile[i] = v / frames.length; });

    // Pose classification
    const poseCounts: Record<PoseLabel, number> = { still: 0, subtle: 0, gesture: 0, movement: 0, active: 0 };
    const poseSegments: PoseSegment[] = [];
    let currentPose: PoseLabel = frames[0].motion.pose;
    let segStart = 0;
    frames.forEach((f, i) => {
      poseCounts[f.motion.pose]++;
      if (f.motion.pose !== currentPose || i === frames.length - 1) {
        poseSegments.push({ pose: currentPose, startFrame: segStart, endFrame: i - 1, frameCount: i - segStart });
        currentPose = f.motion.pose;
        segStart = i;
      }
    });

    // Sound pattern (basic)
    const pitchContour = frames.map(f => f.sound.pitch);
    const volumeContour = frames.map(f => f.sound.volume);
    const voicedPitches = pitchContour.filter(p => p > 0);
    const avgPitch = voicedPitches.length > 0 ? voicedPitches.reduce((a, b) => a + b, 0) / voicedPitches.length : 0;
    const avgVolume = volumeContour.reduce((a, b) => a + b, 0) / volumeContour.length;

    let peaks = 0;
    for (let i = 1; i < volumeContour.length - 1; i++) {
      if (volumeContour[i] > volumeContour[i - 1] && volumeContour[i] > volumeContour[i + 1] && volumeContour[i] > avgVolume * 0.5) {
        peaks++;
      }
    }
    const syllableRate = duration > 0 ? peaks / duration : 0;

    // Spectral fingerprint contours
    const spectralCentroidContour = frames.map(f => f.sound.spectral.centroid);
    const spectralZcrContour = frames.map(f => f.sound.spectral.zcr);
    const spectralRolloffContour = frames.map(f => f.sound.spectral.rolloff);
    const avgCentroid = spectralCentroidContour.reduce((a, b) => a + b, 0) / spectralCentroidContour.length;
    const avgZcr = spectralZcrContour.reduce((a, b) => a + b, 0) / spectralZcrContour.length;

    // Onset events
    const onsetTimestamps: number[] = [];
    frames.forEach(f => {
      if (f.sound.isOnset) {
        onsetTimestamps.push(f.timestamp - startTime);
      }
    });
    const onsetCount = onsetTimestamps.length;

    // BPM estimation from onset intervals
    let beatsPerMinute = 0;
    if (onsetTimestamps.length > 2) {
      const intervals: number[] = [];
      for (let i = 1; i < onsetTimestamps.length; i++) {
        intervals.push(onsetTimestamps[i] - onsetTimestamps[i - 1]);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avgInterval > 0) {
        beatsPerMinute = Math.round(60000 / avgInterval);
      }
    }

    // Sound events from classifier
    const events = this.soundClassifier.getEvents();
    const eventSummary = this.soundClassifier.getSummary();

    // Eyes pattern
    const zoneDwellTimes: Record<string, number> = {};
    const zoneSequence: string[] = [];
    const zoneTimeline: { time: number; zone: string }[] = [];
    let faceDetectedCount = 0;

    frames.forEach(f => {
      const zone = f.gaze.zone;
      zoneDwellTimes[zone] = (zoneDwellTimes[zone] || 0) + (1 / 30);
      if (zoneSequence[zoneSequence.length - 1] !== zone) {
        zoneSequence.push(zone);
        zoneTimeline.push({ time: Math.round((f.timestamp - startTime) / 100) / 10, zone });
      }
      if (f.gaze.faceDetected) faceDetectedCount++;
    });

    const primaryZone = Object.entries(zoneDwellTimes)
      .sort(([, a], [, b]) => b - a)[0]?.[0] || 'center';

    // Downsample
    const downsample = (arr: number[], maxPoints = 100) => {
      if (arr.length <= maxPoints) return arr;
      const step = Math.ceil(arr.length / maxPoints);
      const result: number[] = [];
      for (let i = 0; i < arr.length; i += step) result.push(arr[i]);
      return result;
    };

    const centroidPath = frames.map(f => ({ x: f.motion.centroidX, y: f.motion.centroidY }));
    const sampledCentroid = centroidPath.length > 50
      ? Array.from({ length: 50 }, (_, i) => centroidPath[Math.floor(i * centroidPath.length / 50)])
      : centroidPath;

    // Sample pose snapshots
    const maxSnapshots = 10;
    let poseSnapshots: PoseLandmarkSnapshot[] = [];
    if (this.poseLandmarkBuffer.length <= maxSnapshots) {
      poseSnapshots = [...this.poseLandmarkBuffer];
    } else {
      const step = Math.floor(this.poseLandmarkBuffer.length / maxSnapshots);
      for (let i = 0; i < maxSnapshots; i++) poseSnapshots.push(this.poseLandmarkBuffer[i * step]);
    }

    return {
      motion: {
        avgMotionLevel, regionProfile, motionTimeline: downsample(motionLevels),
        centroidPath: sampledCentroid, poseCounts, poseSegments: poseSegments.slice(0, 50),
        totalFrames: frames.length, poseSnapshots,
      },
      sound: {
        pitchContour: downsample(pitchContour), volumeContour: downsample(volumeContour),
        avgPitch: Math.round(avgPitch), avgVolume: Math.round(avgVolume * 10) / 10,
        syllableRate: Math.round(syllableRate * 10) / 10,
        spectralCentroidContour: downsample(spectralCentroidContour),
        spectralZcrContour: downsample(spectralZcrContour),
        spectralRolloffContour: downsample(spectralRolloffContour),
        avgCentroid: Math.round(avgCentroid), avgZcr: Math.round(avgZcr * 1000) / 1000,
        onsetTimestamps, onsetCount, beatsPerMinute,
        eventSummary, events: events.slice(0, 200),
      },
      eyes: {
        zoneDwellTimes, zoneSequence: zoneSequence.slice(0, 100),
        zoneTimeline: zoneTimeline.slice(0, 100), primaryZone,
        faceDetectedRatio: faceDetectedCount / frames.length,
      },
      duration: Math.round(duration * 10) / 10,
      frameCount: frames.length,
    };
  }

  getFrames(): MSEFrame[] { return [...this.frames]; }
  getLatestFrame(): MSEFrame | null { return this.frames.length > 0 ? this.frames[this.frames.length - 1] : null; }

  destroy(): void {
    this.stop();
    this.audioAnalyzer.destroy();
    this.motionDetector.reset();
    this.soundClassifier.reset();
    this.frames = [];
  }

  private emptyPattern(): MSEPattern {
    return {
      motion: { avgMotionLevel: 0, regionProfile: new Array(9).fill(0), motionTimeline: [], centroidPath: [], poseCounts: { still: 0, subtle: 0, gesture: 0, movement: 0, active: 0 }, poseSegments: [], totalFrames: 0, poseSnapshots: [] },
      sound: {
        pitchContour: [], volumeContour: [], avgPitch: 0, avgVolume: 0, syllableRate: 0,
        spectralCentroidContour: [], spectralZcrContour: [], spectralRolloffContour: [],
        avgCentroid: 0, avgZcr: 0, onsetTimestamps: [], onsetCount: 0, beatsPerMinute: 0,
        eventSummary: { silence: 0, voice: 0, clap: 0, snap: 0, slap: 0, stomp: 0, percussion: 0, unknown: 0 },
        events: [],
      },
      eyes: { zoneDwellTimes: {}, zoneSequence: [], zoneTimeline: [], primaryZone: 'center', faceDetectedRatio: 0 },
      duration: 0, frameCount: 0,
    };
  }
}
