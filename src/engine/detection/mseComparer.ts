/**
 * Compare two MSE patterns and produce consciousness scores.
 */

import type { MSEPattern } from './mseDetector';
import { compareMultiFramePose } from './poseComparer';

export interface MSEScores {
  overall: number;
  motion: { score: number; breakdown: Record<string, number>; feedback: string[] };
  sound: { score: number; breakdown: Record<string, number>; feedback: string[] };
  eyes: { score: number; breakdown: Record<string, number>; feedback: string[] };
}

export function compareMSE(
  reference: MSEPattern,
  learner: MSEPattern,
  weights = { motion: 1, sound: 1, eyes: 1 }
): MSEScores {
  const motionResult = compareMotion(reference, learner);
  const soundResult = compareSound(reference, learner);
  const eyesResult = compareEyes(reference, learner);

  const totalWeight = weights.motion + weights.sound + weights.eyes;
  const overall = totalWeight > 0
    ? Math.round((motionResult.score * weights.motion + soundResult.score * weights.sound + eyesResult.score * weights.eyes) / totalWeight)
    : 0;

  return { overall, motion: motionResult, sound: soundResult, eyes: eyesResult };
}

function compareMotion(ref: MSEPattern, learner: MSEPattern) {
  // Compare motion level similarity
  const levelSim = 1 - Math.abs(ref.motion.avgMotionLevel - learner.motion.avgMotionLevel);
  
  // Compare region profile (cosine similarity)
  const regionSim = cosineSimilarity(ref.motion.regionProfile, learner.motion.regionProfile);
  
  // Compare timeline shape
  const timelineSim = timelineCorrelation(ref.motion.motionTimeline, learner.motion.motionTimeline);

  // Skeleton-based joint-angle comparison (if landmarks available)
  const refSnaps = ref.motion.poseSnapshots ?? [];
  const lrnSnaps = learner.motion.poseSnapshots ?? [];
  const poseResult = compareMultiFramePose(refSnaps, lrnSnaps);
  const hasSkeletonData = refSnaps.length > 0 && lrnSnaps.length > 0;

  const intensityScore = Math.round(levelSim * 100);
  const regionScore = Math.round(regionSim * 100);
  const timelineScore = Math.round(timelineSim * 100);
  const skeletonScore = poseResult.overall;

  // Weight skeleton score heavily when available
  const score = hasSkeletonData
    ? Math.round(intensityScore * 0.15 + regionScore * 0.15 + timelineScore * 0.2 + skeletonScore * 0.5)
    : Math.round(intensityScore * 0.3 + regionScore * 0.3 + timelineScore * 0.4);

  const feedback: string[] = [];
  if (hasSkeletonData) {
    feedback.push(...poseResult.feedback);
  }
  if (intensityScore < 60) feedback.push('Try to match the energy level');
  if (timelineScore < 60) feedback.push('Try to match the timing of movements');
  if (score >= 70) feedback.push('Great motion match! ✓');

  const breakdown: Record<string, number> = { intensity: intensityScore, regions: regionScore, timing: timelineScore };
  if (hasSkeletonData) {
    breakdown.skeleton = skeletonScore;
    // Add per-joint breakdown
    Object.entries(poseResult.perJoint).forEach(([j, v]) => {
      breakdown[j] = v;
    });
  }

  return { score, breakdown, feedback };
}

function compareSound(ref: MSEPattern, learner: MSEPattern) {
  // Pitch similarity
  const pitchDiff = ref.sound.avgPitch > 0 && learner.sound.avgPitch > 0
    ? 1 - Math.min(1, Math.abs(ref.sound.avgPitch - learner.sound.avgPitch) / 200)
    : 0.5;

  // Volume similarity
  const volDiff = ref.sound.avgVolume > 0
    ? 1 - Math.min(1, Math.abs(ref.sound.avgVolume - learner.sound.avgVolume) / ref.sound.avgVolume)
    : 0.5;

  // Rhythm similarity (syllable rate)
  const rhythmDiff = ref.sound.syllableRate > 0
    ? 1 - Math.min(1, Math.abs(ref.sound.syllableRate - learner.sound.syllableRate) / ref.sound.syllableRate)
    : 0.5;

  // Contour shape similarity
  const contourSim = timelineCorrelation(ref.sound.volumeContour, learner.sound.volumeContour);

  const pitchScore = Math.round(pitchDiff * 100);
  const volumeScore = Math.round(volDiff * 100);
  const rhythmScore = Math.round(rhythmDiff * 100);
  const contourScore = Math.round(contourSim * 100);
  const score = Math.round((pitchScore * 0.25 + volumeScore * 0.25 + rhythmScore * 0.25 + contourScore * 0.25));

  const feedback: string[] = [];
  if (pitchScore < 60) feedback.push('Adjust your pitch to match the reference');
  if (volumeScore < 60) feedback.push('Match the volume level');
  if (rhythmScore < 60) feedback.push('Try to match the speaking rhythm');
  if (score >= 70) feedback.push('Great voice control! ✓');

  return { score, breakdown: { pitch: pitchScore, volume: volumeScore, rhythm: rhythmScore, contour: contourScore }, feedback };
}

function compareEyes(ref: MSEPattern, learner: MSEPattern) {
  // Zone distribution similarity
  const allZones = new Set([...Object.keys(ref.eyes.zoneDwellTimes), ...Object.keys(learner.eyes.zoneDwellTimes)]);
  const refVec: number[] = [];
  const learnerVec: number[] = [];
  allZones.forEach(zone => {
    refVec.push(ref.eyes.zoneDwellTimes[zone] || 0);
    learnerVec.push(learner.eyes.zoneDwellTimes[zone] || 0);
  });
  const zoneSim = cosineSimilarity(refVec, learnerVec);

  // Primary zone match
  const primaryMatch = ref.eyes.primaryZone === learner.eyes.primaryZone ? 1 : 0.5;

  // Face detection ratio
  const faceScore = learner.eyes.faceDetectedRatio;

  const zoneScore = Math.round(zoneSim * 100);
  const focusScore = Math.round(primaryMatch * 100);
  const presenceScore = Math.round(faceScore * 100);
  const score = Math.round((zoneScore * 0.4 + focusScore * 0.3 + presenceScore * 0.3));

  const feedback: string[] = [];
  if (zoneScore < 60) feedback.push('Match the gaze distribution pattern');
  if (focusScore < 80) feedback.push(`Focus more on ${ref.eyes.primaryZone} zone`);
  if (presenceScore < 70) feedback.push('Keep your face visible to the camera');
  if (score >= 70) feedback.push('Excellent eye contact! ✓');

  return { score, breakdown: { zones: zoneScore, focus: focusScore, presence: presenceScore }, feedback };
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? Math.max(0, dot / denom) : 0;
}

function timelineCorrelation(a: number[], b: number[]): number {
  if (a.length < 2 || b.length < 2) return 0.5;
  // Resample both to same length
  const len = 50;
  const ra = resample(a, len);
  const rb = resample(b, len);
  return cosineSimilarity(ra, rb);
}

function resample(arr: number[], targetLen: number): number[] {
  if (arr.length === targetLen) return arr;
  const result: number[] = [];
  for (let i = 0; i < targetLen; i++) {
    const srcIdx = (i / (targetLen - 1)) * (arr.length - 1);
    const lo = Math.floor(srcIdx);
    const hi = Math.min(arr.length - 1, lo + 1);
    const t = srcIdx - lo;
    result.push(arr[lo] * (1 - t) + arr[hi] * t);
  }
  return result;
}
