import { create } from 'zustand';
import type { ModuleConfig, MSEModuleId } from '@/types/modules';

interface ModuleStoreState {
  configs: Record<MSEModuleId, ModuleConfig>;
  toggleModule: (moduleId: MSEModuleId) => void;
  setActiveMethod: (moduleId: MSEModuleId, methodId: string) => void;
  toggleChart: (moduleId: MSEModuleId, chartId: string) => void;
  setActiveComparer: (moduleId: MSEModuleId, comparerId: string) => void;
  setWeight: (moduleId: MSEModuleId, weight: number) => void;
  resetDefaults: () => void;
}

const defaultConfigs: Record<MSEModuleId, ModuleConfig> = {
  motion: { enabled: true, activeMethodId: 'full-pose', enabledChartIds: ['skeleton-overlay', 'motion-trail'], activeComparerId: 'multi-dtw', weight: 1.0 },
  sound: { enabled: true, activeMethodId: 'full-prosody', enabledChartIds: ['sound-contour', 'waveform'], activeComparerId: 'multi-dtw', weight: 1.0 },
  eyes: { enabled: true, activeMethodId: 'face-mesh-gaze', enabledChartIds: ['gaze-heatmap', 'gaze-timeline'], activeComparerId: 'multi-feature', weight: 1.0 },
};

export const useModuleStore = create<ModuleStoreState>((set) => ({
  configs: { ...defaultConfigs },

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

  resetDefaults: () => set({ configs: { ...defaultConfigs } }),
}));
