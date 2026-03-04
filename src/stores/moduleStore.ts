import { create } from 'zustand';
import type { ModuleConfig, MSEModuleId } from '@/types/modules';

export type SoundMetricId = 'intonation' | 'rhythmPause' | 'energy' | 'timbre';

export interface MetricWeightConfig {
  enabled: boolean;
  weight: number; // 0..1
}

interface ModuleStoreState {
  configs: Record<MSEModuleId, ModuleConfig>;
  soundMetrics: Record<SoundMetricId, MetricWeightConfig>;
  toggleModule: (moduleId: MSEModuleId) => void;
  setActiveMethod: (moduleId: MSEModuleId, methodId: string) => void;
  toggleChart: (moduleId: MSEModuleId, chartId: string) => void;
  setActiveComparer: (moduleId: MSEModuleId, comparerId: string) => void;
  setWeight: (moduleId: MSEModuleId, weight: number) => void;
  toggleSoundMetric: (metricId: SoundMetricId) => void;
  setSoundMetricWeight: (metricId: SoundMetricId, weight: number) => void;
  resetDefaults: () => void;
}

const defaultConfigs: Record<MSEModuleId, ModuleConfig> = {
  motion: { enabled: true, activeMethodId: 'full-pose', enabledChartIds: ['skeleton-overlay', 'motion-trail'], activeComparerId: 'multi-dtw', weight: 1.0 },
  sound: { enabled: true, activeMethodId: 'full-prosody', enabledChartIds: ['sound-contour', 'waveform'], activeComparerId: 'style-dtw', weight: 1.0 },
  eyes: { enabled: true, activeMethodId: 'face-mesh-gaze', enabledChartIds: ['gaze-heatmap', 'gaze-timeline'], activeComparerId: 'multi-feature', weight: 1.0 },
};

const defaultSoundMetrics: Record<SoundMetricId, MetricWeightConfig> = {
  intonation: { enabled: true, weight: 0.10 },
  rhythmPause: { enabled: true, weight: 0.30 },
  energy: { enabled: true, weight: 0.30 },
  timbre: { enabled: true, weight: 0.30 },
};

export const useModuleStore = create<ModuleStoreState>((set) => ({
  configs: { ...defaultConfigs },
  soundMetrics: { ...defaultSoundMetrics },

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

  toggleSoundMetric: (metricId) =>
    set((state) => ({
      soundMetrics: {
        ...state.soundMetrics,
        [metricId]: { ...state.soundMetrics[metricId], enabled: !state.soundMetrics[metricId].enabled },
      },
    })),

  setSoundMetricWeight: (metricId, weight) =>
    set((state) => ({
      soundMetrics: {
        ...state.soundMetrics,
        [metricId]: { ...state.soundMetrics[metricId], weight },
      },
    })),

  resetDefaults: () => set({ configs: { ...defaultConfigs }, soundMetrics: { ...defaultSoundMetrics } }),
}));
