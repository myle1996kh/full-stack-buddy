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

export interface MeasureSAcousticFeatures {
  duration: number;
  tempoBpm: number;
  avgRms: number;
  maxRms: number;
  nSegments: number;
  onsetCount?: number;
  beatConfidence?: number;
  maxAvgRatio?: number;
  flatness?: number;
}

export type DeliveryStateLabel = 'confident' | 'neutral' | 'hesitant' | 'unsure' | 'anxious';
export type PauseKind = 'silent' | 'filled' | 'unknown';
export type BreakStrength = 'minor' | 'major';
export type ElongationKind = 'final_lengthening' | 'hesitation_lengthening' | 'emphasis_lengthening' | 'unknown';
export type PitchMovement = 'rise' | 'fall' | 'flat';

export interface AdvancedPauseEvent {
  start: number;
  end: number;
  dur: number;
  kind: PauseKind;
}

export interface AdvancedPhraseChunk {
  start: number;
  end: number;
  breakStrength: BreakStrength;
  text?: string;
}

export interface AdvancedElongationEvent {
  start: number;
  end: number;
  dur: number;
  expectedRatio?: number;
  token?: string;
  kind: ElongationKind;
}

export interface AdvancedLabelSummary {
  confidenceScore: number;
  hesitationScore: number;
  anxietyScore: number;
  fluencyScore: number;
  label: DeliveryStateLabel;
  labelProbabilities: Record<DeliveryStateLabel, number>;
  evidence: string[];
}

export interface AdvancedSoundAnalysis {
  version: 'adv-sound-v1';
  summary: AdvancedLabelSummary;
  pauses: {
    total: number;
    short: number;
    medium: number;
    long: number;
    totalDurationSec: number;
    longestSec: number;
    events: AdvancedPauseEvent[];
  };
  phrasing: {
    chunkCount: number;
    chunks: AdvancedPhraseChunk[];
  };
  elongation: {
    count: number;
    events: AdvancedElongationEvent[];
  };
  intonation: {
    initialSlope: number;
    finalSlope: number;
    initialMovement: PitchMovement;
    finalMovement: PitchMovement;
    pitchRangeSt: number;
    contourStability: number;
  };
  rhythm: {
    speechRate: number;
    articulationRate: number;
    avgIOI: number;
    regularity: number;
    tempoVariability: number;
  };
  llmPayload: {
    compactSummary: Record<string, unknown>;
    eventSequence: Array<Record<string, unknown>>;
  };
}

export interface SoundPatternV2 {
  duration: number;
  pitchContourNorm: number[];   // normalized semitone contour (legacy, includes zero-fill)
  pitchSlope: number[];         // first derivative (legacy)
  pitchContourVoiced: number[]; // voiced-only interpolated contour (no zero-fill)
  pitchSlopeVoiced: number[];   // first derivative of voiced contour
  energyContourNorm: number[];  // normalized log-energy contour
  spectralCentroidContour: number[]; // z-normalized centroid contour (voice brightness)
  spectralRolloffContour: number[];  // z-normalized rolloff contour (voice warmth)
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
  measureS?: MeasureSAcousticFeatures;
  advanced?: AdvancedSoundAnalysis;
}

export interface SoundCompareResultV2 {
  score: number;                // 0..100
  breakdown: {
    intonation: number;
    rhythmPause: number;
    energy: number;
    timbre: number;
  };
  qualityFactor: number;        // 0.4..1.0
  feedback: string[];
  debug?: Record<string, number>;
}

// Resample target length for contours
export const CONTOUR_LENGTH = 180;

// Frame extraction constants
export const FRAME_HOP_S = 0.02;       // 20ms hop
export const DEFAULT_WINDOW = 2048;     // FFT window samples
