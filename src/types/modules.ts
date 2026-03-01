export type MSEModuleId = 'motion' | 'sound' | 'eyes';

export interface MSEModule<TFrame = any, TPattern = any> {
  id: MSEModuleId;
  name: string;
  color: string;
  icon: string;

  methods: DetectionMethod<TFrame, TPattern>[];
  charts: ChartPluginDef[];
  comparers: ComparerPlugin<TPattern>[];
}

export interface DetectionMethod<TFrame = any, TPattern = any> {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  enabled: boolean;
  requires: ('camera' | 'microphone' | 'pose' | 'hands' | 'face')[];
  extract: (frames: TFrame[]) => TPattern;
  processFrame?: (frame: TFrame) => number;
}

export interface ChartPluginDef {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category: 'realtime' | 'post-session' | 'both';
  dataSource: 'frames' | 'pattern' | 'comparison';
}

export interface ComparerPlugin<TPattern = any> {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  enabled: boolean;
  compare: (reference: TPattern, learner: TPattern) => ComparisonResult;
}

export interface ComparisonResult {
  score: number;
  breakdown: Record<string, number>;
  feedback: string[];
}

// Pattern types
export interface MotionFrame {
  timestamp: number;
  landmarks?: number[][];
  handLandmarks?: number[][][];
}

export interface MotionPattern {
  segments: { type: string; duration: number; landmarks: number[][] }[];
  avgVelocity: number;
  gestureSequence: string[];
}

export interface SoundFrame {
  timestamp: number;
  pitch: number;
  volume: number;
  mfcc?: number[];
}

export interface SoundPattern {
  pitchContour: number[];
  volumeContour: number[];
  rhythmPattern: number[];
  avgPitch: number;
  avgVolume: number;
  syllableRate: number;
}

export interface EyesFrame {
  timestamp: number;
  gazeX: number;
  gazeY: number;
  zone: string;
  blinkDetected: boolean;
}

export interface EyesPattern {
  zoneDwellTimes: Record<string, number>;
  zoneSequence: string[];
  avgFixationDuration: number;
  blinkRate: number;
  primaryZone: string;
}

// Module config state
export interface ModuleConfig {
  activeMethodId: string;
  enabledChartIds: string[];
  activeComparerId: string;
  weight: number;
}

// Score levels
export type ScoreLevel = 'unconscious' | 'awakening' | 'developing' | 'conscious' | 'mastery';

export function getScoreLevel(percent: number): ScoreLevel {
  if (percent <= 20) return 'unconscious';
  if (percent <= 40) return 'awakening';
  if (percent <= 60) return 'developing';
  if (percent <= 80) return 'conscious';
  return 'mastery';
}

export function getScoreLevelLabel(level: ScoreLevel): string {
  const labels: Record<ScoreLevel, string> = {
    unconscious: 'Unconscious',
    awakening: 'Awakening',
    developing: 'Developing',
    conscious: 'Conscious',
    mastery: 'Mastery',
  };
  return labels[level];
}
