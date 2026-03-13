import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Activity, Volume2, Eye, Zap, Play, Square, RotateCcw, ArrowLeft, Trophy, Layers } from 'lucide-react';
import { useCamera } from '@/hooks/useCamera';
import LandmarkOverlay from '@/components/overlay/LandmarkOverlay';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/hooks/use-toast';
import { useModuleStore } from '@/stores/moduleStore';
import { moduleRegistry } from '@/engine/modules/registry';
import { comparePoseLandmarks, type PoseSimilarityResult } from '@/engine/detection/poseComparer';
import { detectPose, ensureMediaPipe } from '@/engine/mediapipe/mediapipeService';
import type { MSEFrame, MSEPattern } from '@/engine/detection/mseDetector';
import {
  getScoreLevel,
  getScoreLevelLabel,
  type ComparisonResult,
  type MotionFrame as ModuleMotionFrame,
  type SoundFrame as ModuleSoundFrame,
  type EyesFrame as ModuleEyesFrame,
  type MSEModuleId,
} from '@/types/modules';
import PoseSkeletonChart from '@/components/charts/PoseSkeletonChart';
import SoundContourChart from '@/components/charts/SoundContourChart';
import GazeMapChart from '@/components/charts/GazeMapChart';
import MSERadarChart from '@/components/charts/MSERadarChart';
import { setMotionAnglesParams, setMotionApplyQualityPenalty } from '@/engine/modules/motionModule';
import {
  setSoundDeliveryParams,
  setSoundFingerprintParams,
  setSoundCoachSParams,
  setSoundApplyQualityPenalty,
} from '@/engine/modules/soundModule';
import { setEyesGazeParams, setEyesApplyQualityPenalty } from '@/engine/modules/eyesModule';
import { CONTOUR_LENGTH as SOUND_CONTOUR_LENGTH } from '@/engine/sound/types';
import { CONTOUR_LENGTH as EYES_CONTOUR_LENGTH } from '@/engine/eyes/types';

interface Lesson {
  id: string;
  title: string;
  captain_name: string;
  difficulty: string;
  weight_motion: number;
  weight_sound: number;
  weight_eyes: number;
  reference_pattern: MSEPattern;
  captain_id: string;
  video_url?: string | null;
}

type PlayState = 'select' | 'ready' | 'practicing' | 'results';
type PlaygroundModuleId = 'motion' | 'sound' | 'eyes';
type SoundViewTab = 'melody' | 'rhythm' | 'energy';

type PlaygroundModuleResult = ComparisonResult & {
  debug?: Record<string, unknown>;
  comparerId: string;
  comparerName: string;
  weight: number;
  enabled: boolean;
};

interface PlaygroundSessionScores {
  overall: number;
  motion: PlaygroundModuleResult;
  sound: PlaygroundModuleResult;
  eyes: PlaygroundModuleResult;
  comparers: Record<PlaygroundModuleId, { id: string; name: string }>;
  weights: Record<PlaygroundModuleId, number>;
  enabledModules: Record<PlaygroundModuleId, boolean>;
  pitchContour?: number[];
  volumeContour?: number[];
  zoneDwellTimes?: Record<string, number>;
}

const MODULE_META: Record<PlaygroundModuleId, {
  icon: typeof Activity;
  label: string;
  color: string;
  textColor: string;
}> = {
  motion: { icon: Activity, label: 'Motion', color: 'bg-mse-motion', textColor: 'text-mse-motion' },
  sound: { icon: Volume2, label: 'Sound', color: 'bg-mse-sound', textColor: 'text-mse-sound' },
  eyes: { icon: Eye, label: 'Eyes', color: 'bg-mse-eyes', textColor: 'text-mse-eyes' },
};

const LEVEL_COLORS: Record<string, string> = {
  unconscious: 'text-score-gray',
  awakening: 'text-score-yellow',
  developing: 'text-score-orange',
  conscious: 'text-score-green',
  mastery: 'text-score-gold',
};

function toFiniteNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - m) ** 2)));
}

function max(values: number[]): number {
  return values.length > 0 ? Math.max(...values) : 0;
}

function resample(values: number[], targetLength: number, fallback = 0): number[] {
  if (targetLength <= 0) return [];
  if (values.length === 0) return new Array(targetLength).fill(fallback);
  if (values.length === 1) return new Array(targetLength).fill(values[0]);
  if (values.length === targetLength) return [...values];

  const result: number[] = [];
  for (let i = 0; i < targetLength; i++) {
    const position = (i / Math.max(1, targetLength - 1)) * (values.length - 1);
    const lo = Math.floor(position);
    const hi = Math.min(values.length - 1, lo + 1);
    const t = position - lo;
    result.push(values[lo] * (1 - t) + values[hi] * t);
  }
  return result;
}

function buildPitchContourNorm(pitchContour: number[]): number[] {
  const safePitch = pitchContour.filter((pitch) => pitch > 0);
  const median = safePitch.length > 0
    ? [...safePitch].sort((a, b) => a - b)[Math.floor(safePitch.length / 2)]
    : 200;

  return resample(
    pitchContour.map((pitch) => (pitch > 60 && pitch < 500 ? 12 * Math.log2(pitch / median) : 0)),
    SOUND_CONTOUR_LENGTH,
    0,
  );
}

function buildEnergyContourNorm(volumeContour: number[]): number[] {
  const scaled = (volumeContour.length > 0 ? volumeContour : [0]).map((value) => value / 100);
  const m = mean(scaled);
  const s = std(scaled);
  const normalized = s > 1e-6 ? scaled.map((value) => (value - m) / s) : scaled.map(() => 0);
  return resample(normalized, SOUND_CONTOUR_LENGTH, 0);
}

function formatMetricLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function readStoredNumber(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const raw = Number(window.sessionStorage.getItem(key) ?? String(fallback));
  return Number.isFinite(raw) ? raw : fallback;
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  const raw = window.sessionStorage.getItem(key);
  if (raw == null) return fallback;
  return raw === 'true';
}

function syncPlaygroundRuntimeParamsFromStore(): void {
  const state = useModuleStore.getState();

  setMotionAnglesParams({
    weights: state.motionAnglesParams.weights,
    enabledMetrics: state.motionAnglesParams.enabled,
    powerCurve: state.motionAnglesParams.powerCurve,
  });
  setMotionApplyQualityPenalty(state.motionCompareSettings.applyQualityPenalty);

  setEyesGazeParams({
    weights: state.eyesGazeParams.weights,
    enabledMetrics: state.eyesGazeParams.enabled,
  });
  setEyesApplyQualityPenalty(state.eyesCompareSettings.applyQualityPenalty);

  setSoundDeliveryParams({
    weights: state.deliveryParams.weights,
    enabledMetrics: state.deliveryParams.enabled,
    elongationThreshold: state.deliveryParams.elongationThreshold,
  });
  setSoundFingerprintParams({
    weights: state.fingerprintParams.weights,
    enabledMetrics: state.fingerprintParams.enabled,
  });
  setSoundCoachSParams({
    scoring: {
      tempoGateEnabled: readStoredBoolean('coach-s-tempo-gate-enabled', true),
      tempoGateThreshold: readStoredNumber('coach-s-tempo-gate-threshold', 45),
      tempoGateCapMin: readStoredNumber('coach-s-tempo-gate-cap-min', 20),
      tempoGateCapMax: readStoredNumber('coach-s-tempo-gate-cap-max', 40),
    },
  });
  setSoundApplyQualityPenalty(state.soundCompareSettings.applyQualityPenalty);
}

function makeDisabledResult(comparerId: string, comparerName: string, weight: number): PlaygroundModuleResult {
  return {
    score: 0,
    breakdown: {},
    feedback: ['Module disabled'],
    comparerId,
    comparerName,
    weight,
    enabled: false,
  };
}

function normalizeComparisonResult(
  result: Partial<ComparisonResult> & { debug?: Record<string, unknown> },
  comparerId: string,
  comparerName: string,
  weight: number,
): PlaygroundModuleResult {
  const breakdown = Object.fromEntries(
    Object.entries(result.breakdown ?? {}).map(([key, value]) => [key, Math.round(toFiniteNumber(value) ?? 0)]),
  );

  return {
    score: Math.round(toFiniteNumber(result.score) ?? 0),
    breakdown,
    feedback: Array.isArray(result.feedback) ? result.feedback.map(String) : [],
    debug: result.debug && typeof result.debug === 'object' ? result.debug : undefined,
    comparerId,
    comparerName,
    weight,
    enabled: true,
  };
}

function zoneToPoint(zone: string): { x: number; y: number } {
  const map: Record<string, { x: number; y: number }> = {
    'top-left': { x: 0.17, y: 0.17 },
    'top-center': { x: 0.5, y: 0.17 },
    'top-right': { x: 0.83, y: 0.17 },
    'center-left': { x: 0.17, y: 0.5 },
    'center': { x: 0.5, y: 0.5 },
    'center-right': { x: 0.83, y: 0.5 },
    'bottom-left': { x: 0.17, y: 0.83 },
    'bottom-center': { x: 0.5, y: 0.83 },
    'bottom-right': { x: 0.83, y: 0.83 },
  };
  return map[zone] ?? map.center;
}

function resolveModuleMethod(moduleId: PlaygroundModuleId, methodId: string) {
  const module = moduleRegistry[moduleId];
  return module.methods.find((method) => method.id === methodId)
    ?? module.methods.find((method) => method.isDefault)
    ?? module.methods[0];
}

function buildMotionPatternForPlayground(pattern: MSEPattern, methodId: string): any {
  const snapshots = [...(pattern.motion.poseSnapshots ?? [])].sort((a, b) => a.frameIndex - b.frameIndex);
  const durationMs = Math.max((pattern.duration || 0) * 1000, snapshots.length * 200);
  const totalFrames = Math.max(pattern.motion.totalFrames || pattern.frameCount || snapshots.length, 1);

  const frames: ModuleMotionFrame[] = snapshots.map((snapshot, index) => ({
    timestamp: totalFrames > 1
      ? (snapshot.frameIndex / Math.max(1, totalFrames - 1)) * durationMs
      : index * 200,
    landmarks: snapshot.landmarks.map((landmark) => [landmark.x, landmark.y, landmark.z]),
  }));

  if (frames.length > 0) {
    const method = resolveModuleMethod('motion', methodId);
    return method.extract(frames as any);
  }

  return {
    segments: (pattern.motion.poseSegments ?? []).map((segment) => ({
      type: segment.pose,
      duration: (segment.frameCount / Math.max(1, pattern.motion.totalFrames || pattern.frameCount || 1)) * Math.max(pattern.duration, 0.1),
      landmarks: [] as number[][],
    })),
    avgVelocity: pattern.motion.avgMotionLevel ?? 0,
    gestureSequence: (pattern.motion.poseSegments ?? []).map((segment) => segment.pose),
  };
}

function buildSoundPatternForPlayground(pattern: MSEPattern, methodId: string): any {
  const contourLength = Math.max(pattern.sound.pitchContour.length, pattern.sound.volumeContour.length, 1);
  const durationMs = Math.max((pattern.duration || 0) * 1000, contourLength * 33);
  const pitchContour = pattern.sound.pitchContour.length > 0
    ? pattern.sound.pitchContour
    : new Array(contourLength).fill(pattern.sound.avgPitch || 0);
  const volumeContour = pattern.sound.volumeContour.length > 0
    ? pattern.sound.volumeContour
    : new Array(contourLength).fill(pattern.sound.avgVolume || 0);

  const frames: ModuleSoundFrame[] = Array.from({ length: contourLength }, (_, index) => ({
    timestamp: contourLength > 1 ? (index / Math.max(1, contourLength - 1)) * durationMs : 0,
    pitch: pitchContour[index] ?? 0,
    volume: volumeContour[index] ?? 0,
  }));

  const method = resolveModuleMethod('sound', methodId);
  const legacyPattern = method.extract(frames as any) as Record<string, unknown>;

  const pitchContourNorm = buildPitchContourNorm(pitchContour);
  const pitchSlope = pitchContourNorm.map((value, index) => (index > 0 ? value - pitchContourNorm[index - 1] : 0));
  const energyContourNorm = buildEnergyContourNorm(volumeContour);
  const onsetTimes = (pattern.sound.onsetTimestamps ?? []).map((ms) => ms / 1000).sort((a, b) => a - b);
  const onsetDiffsMs = (pattern.sound.onsetTimestamps ?? []).slice(1).map((value, index) => value - (pattern.sound.onsetTimestamps?.[index] ?? 0)).filter((value) => value > 0);
  const avgIOI = onsetDiffsMs.length > 0
    ? mean(onsetDiffsMs)
    : pattern.sound.beatsPerMinute > 0
      ? 60000 / pattern.sound.beatsPerMinute
      : 0;
  const regularity = avgIOI > 0 && onsetDiffsMs.length > 1
    ? clamp(1 - std(onsetDiffsMs) / avgIOI, 0, 1)
    : 0;
  const avgRms = clamp((pattern.sound.avgVolume || mean(volumeContour)) / 100, 0, 1.5);
  const maxRms = clamp(max(volumeContour) / 100, avgRms, 2);
  const voicedRatio = pitchContour.filter((pitch) => pitch > 0).length / Math.max(1, pitchContour.length);
  const maxAvgRatio = avgRms > 1e-6 ? maxRms / avgRms : 1;
  const flatness = avgRms > 1e-6 ? clamp(1 - (maxRms - avgRms) / avgRms, 0, 1) : 1;

  const v2Pattern = {
    duration: pattern.duration,
    pitchContourNorm,
    pitchSlope,
    pitchContourVoiced: pitchContourNorm,
    pitchSlopeVoiced: pitchSlope,
    energyContourNorm,
    spectralCentroidContour: resample(pattern.sound.spectralCentroidContour ?? [], SOUND_CONTOUR_LENGTH, 0),
    spectralRolloffContour: resample(pattern.sound.spectralRolloffContour ?? [], SOUND_CONTOUR_LENGTH, 0),
    onsetTimes,
    pausePattern: [],
    speechRate: pattern.sound.syllableRate ?? 0,
    avgIOI,
    regularity,
    voicedRatio,
    quality: {
      snrLike: 20,
      clippingRatio: 0,
      confidence: pattern.frameCount > 0 ? 0.7 : 0.4,
    },
    measureS: {
      duration: pattern.duration,
      tempoBpm: pattern.sound.beatsPerMinute || (pattern.sound.syllableRate ?? 0) * 60,
      avgRms,
      maxRms,
      nSegments: Math.max(1, (pattern.sound.onsetCount ?? onsetTimes.length) + 1),
      onsetCount: pattern.sound.onsetCount ?? onsetTimes.length,
      beatConfidence: onsetTimes.length >= 2 ? 0.65 : 0.25,
      maxAvgRatio,
      flatness,
    },
  };

  return {
    ...legacyPattern,
    pitchContour,
    volumeContour,
    rhythmPattern: Array.isArray(legacyPattern.rhythmPattern) ? legacyPattern.rhythmPattern : [],
    avgPitch: pattern.sound.avgPitch ?? 0,
    avgVolume: pattern.sound.avgVolume ?? 0,
    syllableRate: pattern.sound.syllableRate ?? 0,
    _v2: v2Pattern,
  };
}

function buildEyesPatternForPlayground(pattern: MSEPattern): any {
  const zoneSequence = pattern.eyes.zoneSequence ?? [];
  const zoneTimeline = pattern.eyes.zoneTimeline ?? [];
  const points = (zoneTimeline.length > 0 ? zoneTimeline : zoneSequence.map((zone, index) => ({ time: index, zone })))
    .map((entry) => zoneToPoint(entry.zone));
  const totalDwell = Object.values(pattern.eyes.zoneDwellTimes ?? {}).reduce((sum, value) => sum + value, 0);
  const avgFixationDuration = zoneSequence.length > 0 ? totalDwell / zoneSequence.length : 0;
  const focused = pattern.eyes.primaryZone === 'center' ? 0.6 : 0.45;
  const scanning = zoneSequence.length > 1 ? 0.35 : 0.2;
  const away = clamp(1 - focused - scanning, 0, 1);

  const v2Pattern = {
    duration: pattern.duration,
    gazeContourX: resample(points.map((point) => point.x), EYES_CONTOUR_LENGTH, 0.5),
    gazeContourY: resample(points.map((point) => point.y), EYES_CONTOUR_LENGTH, 0.5),
    zoneDwellTimes: pattern.eyes.zoneDwellTimes ?? {},
    zoneSequence,
    attentionSegments: [],
    attentionDistribution: { focused, scanning, away },
    blinkRate: 0,
    blinkCount: 0,
    avgFixationDuration,
    blinkMetrics: {
      avgDuration: 0,
      durationStdDev: 0,
      rateVariability: 0,
    },
    headPoseProfile: {
      avgYaw: 0,
      avgPitch: 0,
      yawStability: 0,
      pitchStability: 0,
    },
    primaryZone: pattern.eyes.primaryZone || 'center',
    quality: {
      faceDetectedRatio: pattern.eyes.faceDetectedRatio ?? 0.5,
      avgConfidence: pattern.eyes.faceDetectedRatio ?? 0.5,
    },
  };

  const frames: ModuleEyesFrame[] = points.map((point, index) => ({
    timestamp: points.length > 1 ? (index / Math.max(1, points.length - 1)) * Math.max((pattern.duration || 0) * 1000, 1) : 0,
    gazeX: point.x,
    gazeY: point.y,
    zone: zoneSequence[index] ?? pattern.eyes.primaryZone ?? 'center',
    blinkDetected: false,
  }));

  const method = resolveModuleMethod('eyes', 'face-mesh-gaze');
  const legacyPattern = frames.length > 0
    ? (method.extract(frames as any) as Record<string, unknown>)
    : {
        zoneDwellTimes: pattern.eyes.zoneDwellTimes ?? {},
        zoneSequence,
        avgFixationDuration,
        blinkRate: 0,
        primaryZone: pattern.eyes.primaryZone ?? 'center',
      };

  return {
    ...legacyPattern,
    _v2: v2Pattern,
  };
}

function getModuleWeight(lesson: Lesson, moduleId: PlaygroundModuleId): number {
  if (moduleId === 'motion') return lesson.weight_motion;
  if (moduleId === 'sound') return lesson.weight_sound;
  return lesson.weight_eyes;
}

async function compareWithActiveModules(lesson: Lesson, learnerPattern: MSEPattern): Promise<PlaygroundSessionScores> {
  syncPlaygroundRuntimeParamsFromStore();
  const store = useModuleStore.getState();

  const enabledModules: Record<PlaygroundModuleId, boolean> = {
    motion: store.configs.motion.enabled,
    sound: store.configs.sound.enabled,
    eyes: store.configs.eyes.enabled,
  };

  const weights: Record<PlaygroundModuleId, number> = {
    motion: getModuleWeight(lesson, 'motion'),
    sound: getModuleWeight(lesson, 'sound'),
    eyes: getModuleWeight(lesson, 'eyes'),
  };

  const comparisonEntries = await Promise.all((Object.keys(MODULE_META) as PlaygroundModuleId[]).map(async (moduleId) => {
    const module = moduleRegistry[moduleId];
    const config = store.configs[moduleId];
    const comparer = module.comparers.find((item) => item.id === config.activeComparerId)
      ?? module.comparers.find((item) => item.isDefault)
      ?? module.comparers[0];

    if (!enabledModules[moduleId]) {
      return [moduleId, makeDisabledResult(comparer.id, comparer.name, weights[moduleId])] as const;
    }

    try {
      const referenceInput = moduleId === 'motion'
        ? buildMotionPatternForPlayground(lesson.reference_pattern, config.activeMethodId)
        : moduleId === 'sound'
          ? buildSoundPatternForPlayground(lesson.reference_pattern, config.activeMethodId)
          : buildEyesPatternForPlayground(lesson.reference_pattern);

      const learnerInput = moduleId === 'motion'
        ? buildMotionPatternForPlayground(learnerPattern, config.activeMethodId)
        : moduleId === 'sound'
          ? buildSoundPatternForPlayground(learnerPattern, config.activeMethodId)
          : buildEyesPatternForPlayground(learnerPattern);

      const rawResult = await Promise.resolve(comparer.compare(referenceInput as any, learnerInput as any)) as ComparisonResult & {
        debug?: Record<string, unknown>;
      };

      return [moduleId, normalizeComparisonResult(rawResult, comparer.id, comparer.name, weights[moduleId])] as const;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown comparison error';
      return [moduleId, {
        score: 0,
        breakdown: {},
        feedback: [`Comparison failed: ${message}`],
        comparerId: comparer.id,
        comparerName: comparer.name,
        weight: weights[moduleId],
        enabled: true,
      } satisfies PlaygroundModuleResult] as const;
    }
  }));

  const moduleResults = Object.fromEntries(comparisonEntries) as Record<PlaygroundModuleId, PlaygroundModuleResult>;
  let weightedSum = 0;
  let totalWeight = 0;

  (Object.keys(MODULE_META) as PlaygroundModuleId[]).forEach((moduleId) => {
    if (!enabledModules[moduleId]) return;
    const weight = weights[moduleId];
    weightedSum += moduleResults[moduleId].score * weight;
    totalWeight += weight;
  });

  return {
    overall: totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0,
    motion: moduleResults.motion,
    sound: moduleResults.sound,
    eyes: moduleResults.eyes,
    comparers: {
      motion: { id: moduleResults.motion.comparerId, name: moduleResults.motion.comparerName },
      sound: { id: moduleResults.sound.comparerId, name: moduleResults.sound.comparerName },
      eyes: { id: moduleResults.eyes.comparerId, name: moduleResults.eyes.comparerName },
    },
    weights,
    enabledModules,
    pitchContour: learnerPattern.sound.pitchContour,
    volumeContour: learnerPattern.sound.volumeContour,
    zoneDwellTimes: learnerPattern.eyes.zoneDwellTimes,
  };
}

function getModuleInsights(
  moduleId: PlaygroundModuleId,
  result: PlaygroundModuleResult,
  referencePattern: MSEPattern,
  learnerPattern: MSEPattern,
): string[] {
  if (moduleId === 'motion') {
    return [
      `Captain avg level ${Math.round((referencePattern.motion.avgMotionLevel || 0) * 100)}%`,
      `Your avg level ${Math.round((learnerPattern.motion.avgMotionLevel || 0) * 100)}%`,
      `${learnerPattern.motion.poseSnapshots?.length ?? 0} pose snapshots matched`,
    ];
  }

  if (moduleId === 'sound') {
    const debug = result.debug ?? {};
    const facts: string[] = [];
    if (typeof debug.grade === 'string') facts.push(`Grade ${debug.grade}`);
    if (Number(debug.rule_tempoGateCap ?? 0) === 1) facts.push('Tempo gate cap');
    else if (Number(debug.rule_energyCap ?? 0) === 1) facts.push('Energy cap');
    else if (Number(debug.rule_energyFloor ?? 0) === 1) facts.push('Energy floor');
    const tempo = toFiniteNumber(debug.tempoScore);
    const energy = toFiniteNumber(debug.energyScore);
    if (tempo !== undefined) facts.push(`Tempo ${Math.round(tempo)}`);
    if (energy !== undefined) facts.push(`Energy ${Math.round(energy)}`);
    return facts.slice(0, 4);
  }

  return [
    `Captain focus ${referencePattern.eyes.primaryZone || 'center'}`,
    `Your focus ${learnerPattern.eyes.primaryZone || 'center'}`,
    `Face detected ${Math.round((learnerPattern.eyes.faceDetectedRatio || 0) * 100)}%`,
  ];
}

function readStoredSoundTab(): SoundViewTab {
  if (typeof window === 'undefined') return 'melody';
  const raw = window.sessionStorage.getItem('playground-sound-view-tab');
  return raw === 'rhythm' || raw === 'energy' ? raw : 'melody';
}

function buildSilenceSegments(volumeContour: number[], duration: number): Array<{ start: number; end: number }> {
  const sampled = resample(volumeContour, Math.min(96, Math.max(24, volumeContour.length || 24)), 0);
  const peak = max(sampled);
  const avg = mean(sampled);
  const threshold = Math.max(4, peak * 0.16, avg * 0.55);
  const segments: Array<{ start: number; end: number }> = [];
  let startIndex = -1;

  sampled.forEach((value, index) => {
    const isQuiet = value <= threshold;
    if (isQuiet && startIndex < 0) startIndex = index;
    if (!isQuiet && startIndex >= 0) {
      const start = (startIndex / sampled.length) * duration;
      const end = (index / sampled.length) * duration;
      if (end - start >= 0.18) segments.push({ start, end });
      startIndex = -1;
    }
  });

  if (startIndex >= 0) {
    const start = (startIndex / sampled.length) * duration;
    const end = duration;
    if (end - start >= 0.18) segments.push({ start, end });
  }

  return segments;
}

function SoundPauseRhythmLane({
  title,
  duration,
  onsetTimestamps,
  volumeContour,
}: {
  title: string;
  duration: number;
  onsetTimestamps: number[];
  volumeContour: number[];
}) {
  const safeDuration = Math.max(duration || 0, 0.1);
  const onsets = [...(onsetTimestamps ?? [])].filter((value) => Number.isFinite(value) && value >= 0 && value <= safeDuration * 1000);
  const silenceSegments = buildSilenceSegments(volumeContour ?? [], safeDuration);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <p className="font-medium">{title}</p>
        <span className="font-mono text-muted-foreground">{onsets.length} onsets · {silenceSegments.length} quiet gaps</span>
      </div>
      <div className="rounded-xl border border-border/50 bg-background/30 p-3">
        <div className="relative h-20 overflow-hidden rounded-lg border border-border/40 bg-gradient-to-b from-background/70 to-background/30">
          <div className="absolute inset-x-0 top-4 h-px bg-border/50" />
          <div className="absolute inset-x-0 bottom-3 h-7 rounded-md bg-mse-sound/5" />

          {silenceSegments.map((segment, index) => (
            <div
              key={`${title}-silence-${index}`}
              className="absolute bottom-3 top-9 rounded bg-yellow-500/20 border border-yellow-500/30"
              style={{
                left: `${(segment.start / safeDuration) * 100}%`,
                width: `${Math.max(1.2, ((segment.end - segment.start) / safeDuration) * 100)}%`,
              }}
              title={`Quiet ${segment.start.toFixed(2)}s → ${segment.end.toFixed(2)}s`}
            />
          ))}

          {onsets.map((timestamp, index) => (
            <div
              key={`${title}-onset-${index}`}
              className="absolute top-2 -translate-x-1/2"
              style={{ left: `${(timestamp / (safeDuration * 1000)) * 100}%` }}
              title={`Onset ${Math.round(timestamp)}ms`}
            >
              <div className="h-8 w-px bg-mse-sound/70" />
              <div className="-mt-1 h-2.5 w-2.5 rounded-full bg-mse-sound shadow-[0_0_0_2px_rgba(255,255,255,0.12)]" />
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground font-mono">
          <span>0.0s</span>
          <span>{safeDuration.toFixed(1)}s</span>
        </div>
      </div>
    </div>
  );
}

function SoundEnergyWaveLane({
  title,
  volumeContour,
}: {
  title: string;
  volumeContour: number[];
}) {
  const bars = resample(volumeContour ?? [], 56, 0);
  const peak = Math.max(1, max(bars));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <p className="font-medium">{title}</p>
        <span className="font-mono text-muted-foreground">Peak {Math.round(peak)}</span>
      </div>
      <div className="rounded-xl border border-border/50 bg-background/30 p-3">
        <div className="h-28 rounded-lg border border-border/40 bg-gradient-to-b from-background/70 to-background/20 px-2 py-3 flex items-end gap-[2px] overflow-hidden">
          {bars.map((value, index) => {
            const normalized = clamp(value / peak, 0, 1);
            return (
              <div
                key={`${title}-bar-${index}`}
                className="flex-1 rounded-t bg-mse-sound/80"
                style={{
                  height: `${Math.max(6, normalized * 100)}%`,
                  opacity: 0.25 + normalized * 0.75,
                }}
                title={`Energy ${Math.round(value)}`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function PlaygroundPage() {
  const { id } = useParams();
  const { user } = useAuthStore();
  const { toast } = useToast();
  const moduleConfigs = useModuleStore((state) => state.configs);

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [playState, setPlayState] = useState<PlayState>(id ? 'ready' : 'select');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [liveFrame, setLiveFrame] = useState<MSEFrame | null>(null);
  const [scores, setScores] = useState<PlaygroundSessionScores | null>(null);
  const [sessionPattern, setSessionPattern] = useState<MSEPattern | null>(null);
  const [soundViewTab, setSoundViewTab] = useState<SoundViewTab>(() => readStoredSoundTab());
  const [showOverlay, setShowOverlay] = useState(true);
  const [saving, setSaving] = useState(false);
  const [livePoseSim, setLivePoseSim] = useState<PoseSimilarityResult | null>(null);
  const [mpStatus, setMpStatus] = useState({ pose: false, face: false });
  const liveMotion = useRef(0);
  const liveVolume = useRef(0);
  const liveGazeZone = useRef('—');
  const mediaPipeReady = useRef(false);
  const frameCounter = useRef(0);
  const refVideoRef = useRef<HTMLVideoElement>(null);
  const [videoPlayable, setVideoPlayable] = useState(true);

  useEffect(() => {
    ensureMediaPipe().then(() => { mediaPipeReady.current = true; }).catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem('playground-sound-view-tab', soundViewTab);
  }, [soundViewTab]);

  const onFrame = useCallback((frame: MSEFrame) => {
    liveMotion.current = Math.round(frame.motion.motionLevel * 100);
    liveVolume.current = Math.round(frame.sound.volume);
    liveGazeZone.current = frame.gaze.zone;
    setLiveFrame(frame);

    frameCounter.current++;
    if (mediaPipeReady.current && lesson?.reference_pattern?.motion?.poseSnapshots?.length && frameCounter.current % 5 === 0) {
      const videoEl = cam.videoRef.current;
      if (videoEl) {
        try {
          const poseResult = detectPose(videoEl, performance.now());
          if (poseResult?.landmarks?.length) {
            const landmarks = poseResult.landmarks[0].map((landmark) => ({ x: landmark.x, y: landmark.y, z: landmark.z }));
            const refSnapshots = lesson.reference_pattern.motion.poseSnapshots;
            const refIndex = Math.min(
              Math.floor((frameCounter.current / 30) % refSnapshots.length),
              refSnapshots.length - 1,
            );
            setLivePoseSim(comparePoseLandmarks(refSnapshots[refIndex].landmarks, landmarks));
          }
        } catch {
          // Ignore realtime pose compare errors.
        }
      }
    }
  }, [lesson]);

  const cam = useCamera({ onFrame });

  useEffect(() => {
    if (id) {
      supabase.from('lessons').select('*').eq('id', id).single().then(({ data }) => {
        if (data) {
          setLesson(data as unknown as Lesson);
          setVideoPlayable(true);
          setPlayState('ready');
        }
      });
    } else {
      supabase.from('lessons').select('*').eq('status', 'published').order('created_at', { ascending: false }).then(({ data }) => {
        setLessons((data || []) as unknown as Lesson[]);
      });
    }
  }, [id]);

  const handleSelectLesson = (selectedLesson: Lesson) => {
    setLesson(selectedLesson);
    setScores(null);
    setSessionPattern(null);
    setVideoPlayable(true);
    setPlayState('ready');
  };

  const handleStart = async () => {
    setScores(null);
    setSessionPattern(null);
    setLivePoseSim(null);
    frameCounter.current = 0;

    await cam.startCamera();
    await cam.startDetection();

    if (refVideoRef.current) {
      refVideoRef.current.currentTime = 0;
      refVideoRef.current.muted = true;
      refVideoRef.current.play().catch(() => {
        setVideoPlayable(false);
      });
    }

    setPlayState('practicing');
  };

  const handleStop = async () => {
    cam.stopDetection();
    const pattern = await cam.extractPattern();
    cam.stopCamera();
    if (refVideoRef.current) refVideoRef.current.pause();

    if (!pattern || !lesson) return;

    try {
      const result = await compareWithActiveModules(lesson, pattern);
      setSessionPattern(pattern);
      setScores(result);
      setPlayState('results');

      if (user) {
        setSaving(true);
        const sessionPayload = {
          ...result,
          motionScore: result.motion.score,
          soundScore: result.sound.score,
          eyesScore: result.eyes.score,
          pitchContour: pattern.sound.pitchContour,
          volumeContour: pattern.sound.volumeContour,
          zoneDwellTimes: pattern.eyes.zoneDwellTimes,
        };

        await supabase.from('sessions').insert({
          crew_id: user.id,
          lesson_id: lesson.id,
          captain_id: lesson.captain_id,
          duration: Math.round(pattern.duration),
          consciousness_percent: result.overall,
          scores: sessionPayload as any,
          level: getScoreLevel(result.overall),
        });
        setSaving(false);
      }
    } catch (error) {
      setSaving(false);
      toast({
        title: 'Scoring failed',
        description: error instanceof Error ? error.message : 'Could not score this session',
        variant: 'destructive',
      });
    }
  };

  const handleRetry = () => {
    setScores(null);
    setSessionPattern(null);
    setPlayState('ready');
  };

  if (playState === 'select') {
    return (
      <div className="space-y-4 animate-slide-up">
        <h1 className="text-2xl font-bold">🎮 Select a Lesson</h1>
        {lessons.length === 0 ? (
          <Card className="glass"><CardContent className="p-8 text-center text-sm text-muted-foreground">No published lessons yet</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {lessons.map((item) => (
              <Card key={item.id} className="glass cursor-pointer hover:border-primary/30 transition-colors" onClick={() => handleSelectLesson(item)}>
                <CardContent className="p-4">
                  <h3 className="font-medium">{item.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1">by {item.captain_name} · {item.difficulty}</p>
                  {item.video_url && (
                    <p className="text-[10px] text-primary mt-1">📹 Has reference video</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (playState === 'results' && scores && lesson && sessionPattern) {
    const level = getScoreLevel(scores.overall);
    const enabledModuleIds = (Object.keys(MODULE_META) as PlaygroundModuleId[]).filter((moduleId) => scores.enabledModules[moduleId]);

    return (
      <div className="space-y-4 animate-slide-up">
        <h1 className="text-xl font-bold">📊 Session Results</h1>

        <Card className="glass overflow-hidden">
          <CardContent className="p-5 md:p-6 space-y-5">
            <div className="grid gap-5 md:grid-cols-[1.1fr,0.9fr] md:items-center">
              <div className="space-y-4 text-center md:text-left">
                <div>
                  <Trophy className={`w-10 h-10 mx-auto md:mx-0 mb-3 ${LEVEL_COLORS[level]}`} />
                  <div className="text-5xl font-bold text-mse-consciousness mb-2">{scores.overall}%</div>
                  <div className={`text-sm font-medium uppercase ${LEVEL_COLORS[level]}`}>{getScoreLevelLabel(level)}</div>
                </div>

                <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                  {enabledModuleIds.map((moduleId) => (
                    <span key={moduleId} className="rounded-full border border-border/60 bg-background/50 px-2.5 py-1 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">{MODULE_META[moduleId].label}</span>
                      {' · '}{scores.comparers[moduleId].name}
                      {' · w='}{scores.weights[moduleId].toFixed(1)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border/50 bg-background/20 p-2">
                <MSERadarChart
                  motion={scores.motion.score}
                  sound={scores.sound.score}
                  eyes={scores.eyes.score}
                  refMotion={100}
                  refSound={100}
                  refEyes={100}
                  showReference
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {enabledModuleIds.map((moduleId) => {
          const meta = MODULE_META[moduleId];
          const result = scores[moduleId];
          const Icon = meta.icon;
          const breakdownEntries = Object.entries(result.breakdown).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 4);
          const insights = getModuleInsights(moduleId, result, lesson.reference_pattern, sessionPattern);

          return (
            <Card key={moduleId} className="glass">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Icon className={`w-4 h-4 ${meta.textColor}`} />
                      <span className="text-sm font-medium">{meta.label}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Comparer: <span className="text-foreground">{result.comparerName}</span> · Weight {result.weight.toFixed(1)}
                    </p>
                  </div>
                  <span className={`text-2xl font-bold ${meta.textColor}`}>{result.score}%</span>
                </div>

                {insights.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {insights.map((fact, index) => (
                      <span key={`${moduleId}-fact-${index}`} className="rounded-full bg-background/60 px-2 py-1 text-[10px] text-muted-foreground border border-border/50">
                        {fact}
                      </span>
                    ))}
                  </div>
                )}

                {breakdownEntries.length > 0 && breakdownEntries.map(([subMetric, value]) => (
                  <div key={subMetric} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{formatMetricLabel(subMetric)}</span>
                      <span className="font-mono">{Math.round(value)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className={`${meta.color} h-full rounded-full transition-all`} style={{ width: `${value}%` }} />
                    </div>
                  </div>
                ))}

                {result.feedback.length > 0 && (
                  <div className="space-y-1.5 rounded-xl border border-border/50 bg-background/30 p-3">
                    {result.feedback.slice(0, 3).map((feedback, index) => (
                      <p key={`${moduleId}-feedback-${index}`} className="text-xs text-muted-foreground">💡 {feedback}</p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {scores.enabledModules.sound && (
          <Card className="glass">
            <CardContent className="p-4 space-y-4">
              <div>
                <h3 className="text-sm font-medium">🔊 Sound Comparison</h3>
                <p className="text-xs text-muted-foreground">Switch views to inspect melody flow, rhythm pauses, and waveform-like energy movement between Captain and your attempt.</p>
              </div>

              <Tabs value={soundViewTab} onValueChange={(value) => setSoundViewTab(value as SoundViewTab)} className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="melody" className="text-xs">Melody Flow</TabsTrigger>
                  <TabsTrigger value="rhythm" className="text-xs">Pause & Rhythm</TabsTrigger>
                  <TabsTrigger value="energy" className="text-xs">Energy Wave</TabsTrigger>
                </TabsList>

                <TabsContent value="melody" className="space-y-4 mt-4">
                  <div className="rounded-xl border border-border/50 bg-background/30 p-3">
                    <p className="text-xs text-muted-foreground">Pitch lên/xuống theo thời gian. Dùng để nhìn flow ngữ điệu và nhấn giọng.</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-border/50 bg-background/30 p-3">
                      <p className="text-xs font-medium mb-2">Captain melody contour</p>
                      <SoundContourChart
                        pitchContour={lesson.reference_pattern.sound.pitchContour ?? []}
                        volumeContour={lesson.reference_pattern.sound.volumeContour ?? []}
                      />
                    </div>
                    <div className="rounded-xl border border-border/50 bg-background/30 p-3">
                      <p className="text-xs font-medium mb-2">Your melody contour</p>
                      <SoundContourChart
                        pitchContour={sessionPattern.sound.pitchContour ?? []}
                        volumeContour={sessionPattern.sound.volumeContour ?? []}
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="rhythm" className="space-y-4 mt-4">
                  <div className="rounded-xl border border-border/50 bg-background/30 p-3">
                    <p className="text-xs text-muted-foreground">Các chấm là onset/điểm bật tiếng. Các block vàng là đoạn yên/quiet tương đối để nhìn pause và nhịp nói.</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <SoundPauseRhythmLane
                      title="Captain rhythm lane"
                      duration={lesson.reference_pattern.duration}
                      onsetTimestamps={lesson.reference_pattern.sound.onsetTimestamps ?? []}
                      volumeContour={lesson.reference_pattern.sound.volumeContour ?? []}
                    />
                    <SoundPauseRhythmLane
                      title="Your rhythm lane"
                      duration={sessionPattern.duration}
                      onsetTimestamps={sessionPattern.sound.onsetTimestamps ?? []}
                      volumeContour={sessionPattern.sound.volumeContour ?? []}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="energy" className="space-y-4 mt-4">
                  <div className="rounded-xl border border-border/50 bg-background/30 p-3">
                    <p className="text-xs text-muted-foreground">Waveform-like energy lane: cột cao = nói mạnh, cột thấp = yếu hoặc gần im.</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <SoundEnergyWaveLane
                      title="Captain energy wave"
                      volumeContour={lesson.reference_pattern.sound.volumeContour ?? []}
                    />
                    <SoundEnergyWaveLane
                      title="Your energy wave"
                      volumeContour={sessionPattern.sound.volumeContour ?? []}
                    />
                  </div>
                </TabsContent>
              </Tabs>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                <div className="rounded-lg border border-border/50 bg-background/40 p-2">
                  <p className="text-muted-foreground">Captain BPM</p>
                  <p className="font-mono text-mse-sound">{lesson.reference_pattern.sound.beatsPerMinute || 0}</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-background/40 p-2">
                  <p className="text-muted-foreground">Your BPM</p>
                  <p className="font-mono text-mse-sound">{sessionPattern.sound.beatsPerMinute || 0}</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-background/40 p-2">
                  <p className="text-muted-foreground">Captain Pitch</p>
                  <p className="font-mono text-mse-sound">{lesson.reference_pattern.sound.avgPitch || 0}Hz</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-background/40 p-2">
                  <p className="text-muted-foreground">Your Pitch</p>
                  <p className="font-mono text-mse-sound">{sessionPattern.sound.avgPitch || 0}Hz</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {scores.enabledModules.motion && (
          <Card className="glass">
            <CardContent className="p-4 space-y-4">
              <div>
                <h3 className="text-sm font-medium">🕺 Motion Comparison</h3>
                <p className="text-xs text-muted-foreground">Side-by-side pose skeleton keyframes from Captain and your session.</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-border/50 bg-background/30 p-3 space-y-2">
                  <p className="text-xs font-medium">Captain pose snapshots</p>
                  <PoseSkeletonChart snapshots={lesson.reference_pattern.motion.poseSnapshots ?? []} />
                </div>
                <div className="rounded-xl border border-border/50 bg-background/30 p-3 space-y-2">
                  <p className="text-xs font-medium">Your pose snapshots</p>
                  <PoseSkeletonChart snapshots={sessionPattern.motion.poseSnapshots ?? []} />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                <div className="rounded-lg border border-border/50 bg-background/40 p-2">
                  <p className="text-muted-foreground">Captain Level</p>
                  <p className="font-mono text-mse-motion">{Math.round((lesson.reference_pattern.motion.avgMotionLevel || 0) * 100)}%</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-background/40 p-2">
                  <p className="text-muted-foreground">Your Level</p>
                  <p className="font-mono text-mse-motion">{Math.round((sessionPattern.motion.avgMotionLevel || 0) * 100)}%</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-background/40 p-2">
                  <p className="text-muted-foreground">Captain Frames</p>
                  <p className="font-mono text-mse-motion">{lesson.reference_pattern.motion.totalFrames || lesson.reference_pattern.frameCount}</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-background/40 p-2">
                  <p className="text-muted-foreground">Your Frames</p>
                  <p className="font-mono text-mse-motion">{sessionPattern.motion.totalFrames || sessionPattern.frameCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {scores.enabledModules.eyes && (
          <Card className="glass">
            <CardContent className="p-4 space-y-4">
              <div>
                <h3 className="text-sm font-medium">👀 Eyes Comparison</h3>
                <p className="text-xs text-muted-foreground">Heatmap view of where Captain looks vs where you looked during practice.</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-border/50 bg-background/30 p-3">
                  <p className="text-xs font-medium mb-2">Captain gaze map</p>
                  <GazeMapChart points={[]} zoneDwellTimes={lesson.reference_pattern.eyes.zoneDwellTimes} />
                </div>
                <div className="rounded-xl border border-border/50 bg-background/30 p-3">
                  <p className="text-xs font-medium mb-2">Your gaze map</p>
                  <GazeMapChart points={[]} zoneDwellTimes={sessionPattern.eyes.zoneDwellTimes} />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                <div className="rounded-lg border border-border/50 bg-background/40 p-2">
                  <p className="text-muted-foreground">Captain Focus</p>
                  <p className="font-mono text-mse-eyes">{lesson.reference_pattern.eyes.primaryZone || 'center'}</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-background/40 p-2">
                  <p className="text-muted-foreground">Your Focus</p>
                  <p className="font-mono text-mse-eyes">{sessionPattern.eyes.primaryZone || 'center'}</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-background/40 p-2">
                  <p className="text-muted-foreground">Captain Presence</p>
                  <p className="font-mono text-mse-eyes">{Math.round((lesson.reference_pattern.eyes.faceDetectedRatio || 0) * 100)}%</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-background/40 p-2">
                  <p className="text-muted-foreground">Your Presence</p>
                  <p className="font-mono text-mse-eyes">{Math.round((sessionPattern.eyes.faceDetectedRatio || 0) * 100)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3 pb-4">
          <Button variant="outline" className="flex-1 gap-2" onClick={handleRetry}>
            <RotateCcw className="w-4 h-4" /> Try Again
          </Button>
          <Link to="/crew/progress" className="flex-1">
            <Button className="w-full gap-2">View Progress</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-slide-up">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => { cam.destroy(); setPlayState('select'); setLesson(null); }}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-lg font-bold truncate">🎮 {lesson?.title || 'Playground'}</h1>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="glass overflow-hidden">
          <CardContent className="p-0">
            <div className="aspect-video bg-muted/30 relative">
              {lesson?.video_url && videoPlayable ? (
                <video
                  ref={refVideoRef}
                  src={lesson.video_url}
                  className="w-full h-full object-cover"
                  playsInline
                  preload="auto"
                  loop
                  muted
                  controls
                  onLoadedData={() => setVideoPlayable(true)}
                  onError={() => setVideoPlayable(false)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center p-3">
                  <div className="text-center w-full space-y-2">
                    <p className="text-[10px] text-muted-foreground">🧑‍✈️ Captain detected pattern</p>
                    {lesson && (
                      <>
                        <div className="grid grid-cols-3 gap-2 text-[10px]">
                          <div className="rounded border border-border/40 bg-background/40 px-2 py-1">
                            <p className="text-muted-foreground">Motion</p>
                            <p className="font-mono text-mse-motion">{Math.round((lesson.reference_pattern?.motion?.avgMotionLevel || 0) * 100)}%</p>
                          </div>
                          <div className="rounded border border-border/40 bg-background/40 px-2 py-1">
                            <p className="text-muted-foreground">Pitch</p>
                            <p className="font-mono text-mse-sound">{lesson.reference_pattern?.sound?.avgPitch || 0}Hz</p>
                          </div>
                          <div className="rounded border border-border/40 bg-background/40 px-2 py-1">
                            <p className="text-muted-foreground">Gaze</p>
                            <p className="font-mono text-mse-eyes">{lesson.reference_pattern?.eyes?.primaryZone || '—'}</p>
                          </div>
                        </div>
                        <p className="text-[9px] text-muted-foreground">{lesson?.video_url ? 'Video không phát được trên trình duyệt này, đang dùng pattern làm mẫu.' : 'Lesson này chưa có video, đang dùng pattern làm mẫu.'}</p>
                      </>
                    )}
                  </div>
                </div>
              )}
              <p className="absolute top-1 left-1 text-[10px] text-muted-foreground bg-background/60 px-1 rounded">🧑‍✈️ Captain</p>
            </div>
          </CardContent>
        </Card>

        <Card className="glass overflow-hidden">
          <CardContent className="p-0">
            <div className="aspect-video bg-muted/30 relative">
              <video
                ref={cam.videoRef}
                className="w-full h-full object-cover"
                muted
                playsInline
                style={{ transform: 'scaleX(-1)' }}
              />
              {showOverlay && (
                <LandmarkOverlay
                  videoRef={cam.videoRef as React.RefObject<HTMLVideoElement>}
                  active={cam.active}
                  mirrored={true}
                  onResults={(pose, face) => setMpStatus({ pose: Boolean(pose?.landmarks?.length), face: Boolean(face?.faceLandmarks?.length) })}
                />
              )}
              {!cam.active && playState === 'practicing' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              <p className="absolute top-1 left-1 text-[10px] text-muted-foreground bg-background/60 px-1 rounded">🎥 You</p>
              <button
                onClick={() => setShowOverlay((value) => !value)}
                className={`absolute bottom-1 right-1 p-1 rounded backdrop-blur-sm transition-colors ${
                  showOverlay ? 'bg-primary/20 text-primary' : 'bg-muted/60 text-muted-foreground'
                }`}
                title={showOverlay ? 'Hide overlay' : 'Show overlay'}
              >
                <Layers className="w-3 h-3" />
              </button>
              {showOverlay && cam.active && (
                <div className="absolute bottom-1 left-1 text-[9px] px-1.5 py-0.5 rounded bg-background/70 border border-border/50 font-mono">
                  MP P:{mpStatus.pose ? '✓' : '…'} F:{mpStatus.face ? '✓' : '…'}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {(!lesson?.video_url || !videoPlayable) && lesson?.reference_pattern?.motion?.poseSnapshots?.length ? (
        <Card className="glass">
          <CardContent className="p-4 space-y-2">
            <h3 className="text-sm font-medium">Captain Pose Pattern</h3>
            <p className="text-xs text-muted-foreground">Không có video record — dùng skeleton keyframes để bạn bắt chước theo.</p>
            <PoseSkeletonChart snapshots={lesson.reference_pattern.motion.poseSnapshots} />
          </CardContent>
        </Card>
      ) : null}

      <Card className="glass">
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-medium">Real-time MSE Match</h3>
          {([
            { icon: Activity, label: 'Motion', value: liveMotion.current, color: 'bg-mse-motion' },
            { icon: Volume2, label: 'Sound', value: Math.min(100, liveVolume.current), color: 'bg-mse-sound' },
            { icon: Eye, label: 'Eyes', value: liveFrame?.gaze.faceDetected ? 80 : 20, color: 'bg-mse-eyes' },
          ]).map((item) => (
            <div key={item.label} className="flex items-center gap-3">
              <item.icon className="w-4 h-4 shrink-0" />
              <div className="flex-1">
                <div className="flex justify-between text-xs mb-1">
                  <span>{item.label}</span>
                  <span className="font-mono">{playState === 'practicing' ? `${item.value}%` : '—'}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full ${item.color} transition-all duration-200`}
                    style={{ width: playState === 'practicing' ? `${item.value}%` : '0%' }}
                  />
                </div>
              </div>
            </div>
          ))}

          {playState === 'practicing' && livePoseSim && (
            <div className="pt-2 border-t border-border/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">🦴 Pose Similarity</span>
                <span
                  className="font-mono text-sm font-bold"
                  style={{
                    color: livePoseSim.overall >= 70
                      ? 'hsl(var(--mse-motion))'
                      : livePoseSim.overall >= 40
                        ? 'hsl(var(--score-yellow))'
                        : 'hsl(var(--destructive))',
                  }}
                >
                  {livePoseSim.overall}%
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {Object.entries(livePoseSim.perJoint).map(([joint, value]) => (
                  <div key={joint} className="text-center">
                    <div className="text-[8px] text-muted-foreground truncate">{joint.replace(/([A-Z])/g, ' $1').trim()}</div>
                    <div className="h-1 rounded-full bg-muted overflow-hidden mt-0.5">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${value}%`,
                          backgroundColor: value >= 70
                            ? 'hsl(var(--score-green))'
                            : value >= 40
                              ? 'hsl(var(--score-yellow))'
                              : 'hsl(var(--destructive))',
                        }}
                      />
                    </div>
                    <div className="text-[8px] font-mono text-muted-foreground">{value}%</div>
                  </div>
                ))}
              </div>
              {livePoseSim.feedback.length > 0 && (
                <p className="text-[10px] text-muted-foreground">💡 {livePoseSim.feedback[0]}</p>
              )}
            </div>
          )}

          {playState === 'practicing' && liveFrame && (
            <div className="flex items-center justify-between text-xs pt-1 border-t border-border/30">
              <span className="text-muted-foreground">Pose</span>
              <span className="font-mono capitalize text-mse-consciousness">{liveFrame.motion.pose}</span>
            </div>
          )}

          <div className="pt-2 border-t border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-2"><Zap className="w-4 h-4 text-mse-consciousness" /><span className="text-sm font-medium">Consciousness</span></div>
            <span className="text-xl font-bold text-mse-consciousness">
              {playState === 'practicing' ? `${Math.round((liveMotion.current + Math.min(100, liveVolume.current) + (liveFrame?.gaze.faceDetected ? 80 : 20)) / 3)}%` : '—'}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-center gap-4 pt-2">
        {playState === 'ready' && (
          <Button size="lg" onClick={handleStart} className="gap-2">
            <Play className="w-4 h-4" /> Start Practice
          </Button>
        )}
        {playState === 'practicing' && (
          <>
            <Button size="lg" variant="destructive" onClick={handleStop} className="gap-2">
              <Square className="w-4 h-4" /> Stop
            </Button>
            <span className="text-lg font-mono text-muted-foreground">{cam.elapsed}s</span>
          </>
        )}
      </div>
    </div>
  );
}
