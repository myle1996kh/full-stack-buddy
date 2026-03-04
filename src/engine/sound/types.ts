// ── Sound Pipeline V2 Types ──

export interface SoundFrameV2 {
  t: number;                    // seconds
  pitchHz: number | null;       // null if unvoiced
  pitchConf: number;            // 0..1
  energyDb: number;             // dBFS-like (log RMS)
  centroid: number;             // spectral centroid Hz
  zcr: number;                  // zero-crossing rate 0..1
  rolloff: number;              // spectral rolloff Hz
  flux: number;                 // spectral flux (change)
  voiced: boolean;
}

export interface SpeechSegment {
  start: number;                // seconds
  end: number;                  // seconds
}

export interface PauseEvent {
  pos: number;                  // seconds (center)
  dur: number;                  // seconds
}

export interface SoundPatternV2 {
  duration: number;
  pitchContourNorm: number[];   // normalized semitone contour
  pitchSlope: number[];         // first derivative
  energyContourNorm: number[];  // normalized log-energy contour
  onsetTimes: number[];         // seconds
  pausePattern: PauseEvent[];
  speechRate: number;           // syllables/sec (estimated)
  avgIOI: number;               // ms (inter-onset interval)
  regularity: number;           // 0..1 (onset regularity)
  voicedRatio: number;          // 0..1
  quality: {
    snrLike: number;            // signal-to-noise estimate
    clippingRatio: number;      // ratio of clipped samples
    confidence: number;         // 0..1 overall confidence
  };
}

export interface SoundCompareResultV2 {
  score: number;                // 0..100
  breakdown: {
    intonation: number;
    rhythmPause: number;
    energy: number;
    timbre: number;
  };
  qualityFactor: number;        // 0.6..1.0
  feedback: string[];
  debug?: Record<string, number>;
}

// Resample target length for contours
export const CONTOUR_LENGTH = 180;

// Frame extraction constants
export const FRAME_HOP_S = 0.02;       // 20ms hop
export const DEFAULT_WINDOW = 2048;     // FFT window samples
