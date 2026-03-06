import { create } from 'zustand';
import type { ModuleConfig, MSEModuleId } from '@/types/modules';

export type SoundMetricId = 'intonation' | 'rhythmPause' | 'energy' | 'timbre';
export type DeliveryMetricId = 'elongation' | 'emphasis' | 'expressiveness' | 'rhythm';
export type FingerprintMetricId = 'melody' | 'energy' | 'rhythm' | 'voice';

// Motion V2 metric IDs
export type MotionAnglesMetricId = 'arms' | 'legs' | 'torso' | 'timing';
export type MotionRelativeMetricId = 'upperBody' | 'lowerBody' | 'symmetry' | 'dynamics';
export type MotionInvariantMetricId = 'proportions' | 'angles' | 'topology' | 'dynamics';

// Eyes V2 metric IDs
export type EyesGazeMetricId = 'zoneMatch' | 'sequence' | 'focus' | 'stability' | 'engagement';
export type EyesAttentionMetricId = 'focusRatio' | 'scanPattern' | 'awayTime' | 'transitions';
export type EyesEngagementMetricId = 'gazeContact' | 'headPose' | 'blinkRate' | 'expressiveness';

export interface MetricWeightConfig {
  enabled: boolean;
  weight: number; // 0..1
}

export interface DeliveryParamsConfig {
  weights: Record<DeliveryMetricId, number>;
  enabled: Record<DeliveryMetricId, boolean>;
  elongationThreshold: number; // 1.0 - 3.0
}

export interface FingerprintParamsConfig {
  weights: Record<FingerprintMetricId, number>;
  enabled: Record<FingerprintMetricId, boolean>;
}

export interface SoundCompareSettings {
  applyQualityPenalty: boolean;
}

// Motion V2 params
export interface MotionAnglesParamsConfig {
  weights: Record<MotionAnglesMetricId, number>;
  enabled: Record<MotionAnglesMetricId, boolean>;
  powerCurve: number; // 1.0 - 2.0
}

export interface MotionCompareSettings {
  applyQualityPenalty: boolean;
}

// Eyes V2 params
export interface EyesGazeParamsConfig {
  weights: Record<EyesGazeMetricId, number>;
  enabled: Record<EyesGazeMetricId, boolean>;
}

export interface EyesCompareSettings {
  applyQualityPenalty: boolean;
}

interface ModuleStoreState {
  configs: Record<MSEModuleId, ModuleConfig>;
  // Sound params
  soundMetrics: Record<SoundMetricId, MetricWeightConfig>;
  deliveryParams: DeliveryParamsConfig;
  fingerprintParams: FingerprintParamsConfig;
  soundCompareSettings: SoundCompareSettings;
  // Motion V2 params
  motionAnglesParams: MotionAnglesParamsConfig;
  motionCompareSettings: MotionCompareSettings;
  // Eyes V2 params
  eyesGazeParams: EyesGazeParamsConfig;
  eyesCompareSettings: EyesCompareSettings;
  // Module actions
  toggleModule: (moduleId: MSEModuleId) => void;
  setActiveMethod: (moduleId: MSEModuleId, methodId: string) => void;
  toggleChart: (moduleId: MSEModuleId, chartId: string) => void;
  setActiveComparer: (moduleId: MSEModuleId, comparerId: string) => void;
  setWeight: (moduleId: MSEModuleId, weight: number) => void;
  // Sound actions
  toggleSoundMetric: (metricId: SoundMetricId) => void;
  setSoundMetricWeight: (metricId: SoundMetricId, weight: number) => void;
  setDeliveryWeight: (metricId: DeliveryMetricId, weight: number) => void;
  toggleDeliveryMetric: (metricId: DeliveryMetricId) => void;
  setElongationThreshold: (threshold: number) => void;
  setFingerprintWeight: (metricId: FingerprintMetricId, weight: number) => void;
  toggleFingerprintMetric: (metricId: FingerprintMetricId) => void;
  setApplyQualityPenalty: (enabled: boolean) => void;
  // Motion V2 actions
  setMotionAnglesWeight: (metricId: MotionAnglesMetricId, weight: number) => void;
  toggleMotionAnglesMetric: (metricId: MotionAnglesMetricId) => void;
  setMotionPowerCurve: (value: number) => void;
  setMotionApplyQualityPenalty: (enabled: boolean) => void;
  // Eyes V2 actions
  setEyesGazeWeight: (metricId: EyesGazeMetricId, weight: number) => void;
  toggleEyesGazeMetric: (metricId: EyesGazeMetricId) => void;
  setEyesApplyQualityPenalty: (enabled: boolean) => void;
  // Reset
  resetDefaults: () => void;
}

const defaultConfigs: Record<MSEModuleId, ModuleConfig> = {
  motion: { enabled: true, activeMethodId: 'full-pose', enabledChartIds: ['skeleton-overlay', 'motion-trail'], activeComparerId: 'pose-angles', weight: 1.0 },
  sound: { enabled: true, activeMethodId: 'full-prosody', enabledChartIds: ['sound-contour', 'waveform'], activeComparerId: 'style-delivery', weight: 1.0 },
  eyes: { enabled: true, activeMethodId: 'face-mesh-gaze', enabledChartIds: ['gaze-heatmap', 'gaze-timeline'], activeComparerId: 'gaze-pattern', weight: 1.0 },
};

const defaultSoundMetrics: Record<SoundMetricId, MetricWeightConfig> = {
  intonation: { enabled: true, weight: 0.30 },
  rhythmPause: { enabled: true, weight: 0.25 },
  energy: { enabled: true, weight: 0.20 },
  timbre: { enabled: true, weight: 0.25 },
};

const defaultDeliveryParams: DeliveryParamsConfig = {
  weights: { elongation: 0.35, emphasis: 0.25, expressiveness: 0.20, rhythm: 0.20 },
  enabled: { elongation: true, emphasis: true, expressiveness: true, rhythm: true },
  elongationThreshold: 1.5,
};

const defaultFingerprintParams: FingerprintParamsConfig = {
  weights: { melody: 0.30, energy: 0.25, rhythm: 0.25, voice: 0.20 },
  enabled: { melody: true, energy: true, rhythm: true, voice: true },
};

const defaultSoundCompareSettings: SoundCompareSettings = {
  applyQualityPenalty: true,
};

const defaultMotionAnglesParams: MotionAnglesParamsConfig = {
  weights: { arms: 0.30, legs: 0.25, torso: 0.20, timing: 0.25 },
  enabled: { arms: true, legs: true, torso: true, timing: true },
  powerCurve: 1.5,
};

const defaultMotionCompareSettings: MotionCompareSettings = {
  applyQualityPenalty: true,
};

const defaultEyesGazeParams: EyesGazeParamsConfig = {
  weights: { zoneMatch: 0.30, sequence: 0.25, focus: 0.20, stability: 0.15, engagement: 0.10 },
  enabled: { zoneMatch: true, sequence: true, focus: true, stability: true, engagement: true },
};

const defaultEyesCompareSettings: EyesCompareSettings = {
  applyQualityPenalty: true,
};

export const useModuleStore = create<ModuleStoreState>((set) => ({
  configs: { ...defaultConfigs },
  soundMetrics: { ...defaultSoundMetrics },
  deliveryParams: { ...defaultDeliveryParams },
  fingerprintParams: { ...defaultFingerprintParams },
  soundCompareSettings: { ...defaultSoundCompareSettings },
  motionAnglesParams: { ...defaultMotionAnglesParams },
  motionCompareSettings: { ...defaultMotionCompareSettings },
  eyesGazeParams: { ...defaultEyesGazeParams },
  eyesCompareSettings: { ...defaultEyesCompareSettings },

  toggleModule: (moduleId) =>
    set((state) => ({
      configs: { ...state.configs, [moduleId]: { ...state.configs[moduleId], enabled: !state.configs[moduleId].enabled } },
    })),

  setActiveMethod: (moduleId, methodId) =>
    set((state) => ({
      configs: { ...state.configs, [moduleId]: { ...state.configs[moduleId], activeMethodId: methodId } },
    })),

  toggleChart: (moduleId, chartId) =>
    set((state) => {
      const current = state.configs[moduleId].enabledChartIds;
      const next = current.includes(chartId) ? current.filter(id => id !== chartId) : [...current, chartId];
      return { configs: { ...state.configs, [moduleId]: { ...state.configs[moduleId], enabledChartIds: next } } };
    }),

  setActiveComparer: (moduleId, comparerId) =>
    set((state) => ({
      configs: { ...state.configs, [moduleId]: { ...state.configs[moduleId], activeComparerId: comparerId } },
    })),

  setWeight: (moduleId, weight) =>
    set((state) => ({
      configs: { ...state.configs, [moduleId]: { ...state.configs[moduleId], weight } },
    })),

  // Sound actions
  toggleSoundMetric: (metricId) =>
    set((state) => ({
      soundMetrics: { ...state.soundMetrics, [metricId]: { ...state.soundMetrics[metricId], enabled: !state.soundMetrics[metricId].enabled } },
    })),

  setSoundMetricWeight: (metricId, weight) =>
    set((state) => ({
      soundMetrics: { ...state.soundMetrics, [metricId]: { ...state.soundMetrics[metricId], weight } },
    })),

  setDeliveryWeight: (metricId, weight) =>
    set((state) => ({
      deliveryParams: { ...state.deliveryParams, weights: { ...state.deliveryParams.weights, [metricId]: weight } },
    })),

  toggleDeliveryMetric: (metricId) =>
    set((state) => ({
      deliveryParams: { ...state.deliveryParams, enabled: { ...state.deliveryParams.enabled, [metricId]: !state.deliveryParams.enabled[metricId] } },
    })),

  setElongationThreshold: (threshold) =>
    set((state) => ({
      deliveryParams: { ...state.deliveryParams, elongationThreshold: threshold },
    })),

  setFingerprintWeight: (metricId, weight) =>
    set((state) => ({
      fingerprintParams: { ...state.fingerprintParams, weights: { ...state.fingerprintParams.weights, [metricId]: weight } },
    })),

  toggleFingerprintMetric: (metricId) =>
    set((state) => ({
      fingerprintParams: { ...state.fingerprintParams, enabled: { ...state.fingerprintParams.enabled, [metricId]: !state.fingerprintParams.enabled[metricId] } },
    })),

  setApplyQualityPenalty: (enabled) =>
    set((state) => ({
      soundCompareSettings: { ...state.soundCompareSettings, applyQualityPenalty: enabled },
    })),

  // Motion V2 actions
  setMotionAnglesWeight: (metricId, weight) =>
    set((state) => ({
      motionAnglesParams: { ...state.motionAnglesParams, weights: { ...state.motionAnglesParams.weights, [metricId]: weight } },
    })),

  toggleMotionAnglesMetric: (metricId) =>
    set((state) => ({
      motionAnglesParams: { ...state.motionAnglesParams, enabled: { ...state.motionAnglesParams.enabled, [metricId]: !state.motionAnglesParams.enabled[metricId] } },
    })),

  setMotionPowerCurve: (value) =>
    set((state) => ({
      motionAnglesParams: { ...state.motionAnglesParams, powerCurve: value },
    })),

  setMotionApplyQualityPenalty: (enabled) =>
    set((state) => ({
      motionCompareSettings: { ...state.motionCompareSettings, applyQualityPenalty: enabled },
    })),

  // Eyes V2 actions
  setEyesGazeWeight: (metricId, weight) =>
    set((state) => ({
      eyesGazeParams: { ...state.eyesGazeParams, weights: { ...state.eyesGazeParams.weights, [metricId]: weight } },
    })),

  toggleEyesGazeMetric: (metricId) =>
    set((state) => ({
      eyesGazeParams: { ...state.eyesGazeParams, enabled: { ...state.eyesGazeParams.enabled, [metricId]: !state.eyesGazeParams.enabled[metricId] } },
    })),

  setEyesApplyQualityPenalty: (enabled) =>
    set((state) => ({
      eyesCompareSettings: { ...state.eyesCompareSettings, applyQualityPenalty: enabled },
    })),

  resetDefaults: () => set({
    configs: { ...defaultConfigs },
    soundMetrics: { ...defaultSoundMetrics },
    deliveryParams: { ...defaultDeliveryParams },
    fingerprintParams: { ...defaultFingerprintParams },
    soundCompareSettings: { ...defaultSoundCompareSettings },
    motionAnglesParams: { ...defaultMotionAnglesParams },
    motionCompareSettings: { ...defaultMotionCompareSettings },
    eyesGazeParams: { ...defaultEyesGazeParams },
    eyesCompareSettings: { ...defaultEyesCompareSettings },
  }),
}));
