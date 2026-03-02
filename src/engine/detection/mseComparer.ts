/**
 * Compare two MSE patterns and produce consciousness scores.
 * Sound comparison now uses spectral fingerprint DTW + onset timing match.
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
  const levelSim = 1 - Math.abs(ref.motion.avgMotionLevel - learner.motion.avgMotionLevel);
  const regionSim = cosineSimilarity(ref.motion.regionProfile, learner.motion.regionProfile);
  const timelineSim = timelineCorrelation(ref.motion.motionTimeline, learner.motion.motionTimeline);

  const refSnaps = ref.motion.poseSnapshots ?? [];
  const lrnSnaps = learner.motion.poseSnapshots ?? [];
  const poseResult = compareMultiFramePose(refSnaps, lrnSnaps);
  const hasSkeletonData = refSnaps.length > 0 && lrnSnaps.length > 0;

  const intensityScore = Math.round(levelSim * 100);
  const regionScore = Math.round(regionSim * 100);
  const timelineScore = Math.round(timelineSim * 100);
  const skeletonScore = poseResult.overall;

  const score = hasSkeletonData
    ? Math.round(intensityScore * 0.15 + regionScore * 0.15 + timelineScore * 0.2 + skeletonScore * 0.5)
    : Math.round(intensityScore * 0.3 + regionScore * 0.3 + timelineScore * 0.4);

  const feedback: string[] = [];
  if (hasSkeletonData) feedback.push(...poseResult.feedback);
  if (intensityScore < 60) feedback.push('Try to match the energy level');
  if (timelineScore < 60) feedback.push('Try to match the timing of movements');
  if (score >= 70) feedback.push('Great motion match! ✓');

  const breakdown: Record<string, number> = { intensity: intensityScore, regions: regionScore, timing: timelineScore };
  if (hasSkeletonData) {
    breakdown.skeleton = skeletonScore;
    Object.entries(poseResult.perJoint).forEach(([j, v]) => { breakdown[j] = v; });
  }

  return { score, breakdown, feedback };
}

function compareSound(ref: MSEPattern, learner: MSEPattern) {
  // Basic prosody
  const pitchDiff = ref.sound.avgPitch > 0 && learner.sound.avgPitch > 0
    ? 1 - Math.min(1, Math.abs(ref.sound.avgPitch - learner.sound.avgPitch) / 200)
    : 0.5;
  const volDiff = ref.sound.avgVolume > 0
    ? 1 - Math.min(1, Math.abs(ref.sound.avgVolume - learner.sound.avgVolume) / ref.sound.avgVolume)
    : 0.5;
  const rhythmDiff = ref.sound.syllableRate > 0
    ? 1 - Math.min(1, Math.abs(ref.sound.syllableRate - learner.sound.syllableRate) / ref.sound.syllableRate)
    : 0.5;

  // Spectral fingerprint comparison (DTW-like via timeline correlation)
  const centroidSim = timelineCorrelation(
    ref.sound.spectralCentroidContour ?? [],
    learner.sound.spectralCentroidContour ?? []
  );
  const zcrSim = timelineCorrelation(
    ref.sound.spectralZcrContour ?? [],
    learner.sound.spectralZcrContour ?? []
  );
  const rolloffSim = timelineCorrelation(
    ref.sound.spectralRolloffContour ?? [],
    learner.sound.spectralRolloffContour ?? []
  );

  const hasSpectral = (ref.sound.spectralCentroidContour?.length ?? 0) > 0;
  const spectralScore = hasSpectral
    ? Math.round((centroidSim * 0.4 + zcrSim * 0.3 + rolloffSim * 0.3) * 100)
    : -1;

  // Onset/beat timing comparison
  const onsetScore = compareOnsets(ref.sound.onsetTimestamps ?? [], learner.sound.onsetTimestamps ?? [], ref.duration);

  // Event label comparison
  const eventScore = compareEventSummaries(ref.sound.eventSummary, learner.sound.eventSummary);

  // Contour shape similarity (legacy)
  const contourSim = timelineCorrelation(ref.sound.volumeContour, learner.sound.volumeContour);

  const pitchScore = Math.round(pitchDiff * 100);
  const volumeScore = Math.round(volDiff * 100);
  const rhythmScore = Math.round(rhythmDiff * 100);
  const contourScore = Math.round(contourSim * 100);

  // Weighted score: if spectral data available, weight it heavily
  let score: number;
  if (hasSpectral) {
    score = Math.round(
      pitchScore * 0.10 + volumeScore * 0.10 + rhythmScore * 0.10 +
      spectralScore * 0.25 + onsetScore * 0.25 + eventScore * 0.10 + contourScore * 0.10
    );
  } else {
    score = Math.round(pitchScore * 0.25 + volumeScore * 0.25 + rhythmScore * 0.25 + contourScore * 0.25);
  }

  const feedback: string[] = [];
  if (pitchScore < 60) feedback.push('Adjust your pitch to match the reference');
  if (volumeScore < 60) feedback.push('Match the volume level');
  if (onsetScore < 60) feedback.push('Try to match the rhythm timing — hit beats at the same moments');
  if (spectralScore >= 0 && spectralScore < 60) feedback.push('Sound timbre differs — try matching the tone quality');
  if (eventScore < 60) feedback.push('Try to replicate the same sound actions (claps, voice, etc.)');
  if (score >= 70) feedback.push('Great sound match! ✓');

  const breakdown: Record<string, number> = {
    pitch: pitchScore, volume: volumeScore, rhythm: rhythmScore, contour: contourScore,
  };
  if (hasSpectral) {
    breakdown.spectral = spectralScore;
    breakdown.onset = onsetScore;
    breakdown.events = eventScore;
  }

  return { score, breakdown, feedback };
}

/**
 * Compare onset timestamps with tolerance window.
 */
function compareOnsets(refOnsets: number[], learnerOnsets: number[], duration: number): number {
  if (refOnsets.length === 0 && learnerOnsets.length === 0) return 75; // both silent
  if (refOnsets.length === 0 || learnerOnsets.length === 0) return 30;

  const toleranceMs = Math.max(150, duration * 10); // adaptive tolerance
  let matched = 0;
  const usedLearner = new Set<number>();

  for (const refT of refOnsets) {
    for (let j = 0; j < learnerOnsets.length; j++) {
      if (usedLearner.has(j)) continue;
      if (Math.abs(refT - learnerOnsets[j]) <= toleranceMs) {
        matched++;
        usedLearner.add(j);
        break;
      }
    }
  }

  const precision = learnerOnsets.length > 0 ? usedLearner.size / learnerOnsets.length : 0;
  const recall = refOnsets.length > 0 ? matched / refOnsets.length : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  return Math.round(f1 * 100);
}

/**
 * Compare event label distributions using cosine similarity.
 */
function compareEventSummaries(
  refSummary?: Record<string, number>,
  learnerSummary?: Record<string, number>
): number {
  if (!refSummary || !learnerSummary) return 50;
  const labels = ['voice', 'clap', 'snap', 'slap', 'stomp', 'percussion'];
  const refVec = labels.map(l => refSummary[l] ?? 0);
  const lrnVec = labels.map(l => learnerSummary[l] ?? 0);
  const total = refVec.reduce((a, b) => a + b, 0) + lrnVec.reduce((a, b) => a + b, 0);
  if (total === 0) return 75;
  return Math.round(cosineSimilarity(refVec, lrnVec) * 100);
}

function compareEyes(ref: MSEPattern, learner: MSEPattern) {
  const allZones = new Set([...Object.keys(ref.eyes.zoneDwellTimes), ...Object.keys(learner.eyes.zoneDwellTimes)]);
  const refVec: number[] = [];
  const learnerVec: number[] = [];
  allZones.forEach(zone => {
    refVec.push(ref.eyes.zoneDwellTimes[zone] || 0);
    learnerVec.push(learner.eyes.zoneDwellTimes[zone] || 0);
  });
  const zoneSim = cosineSimilarity(refVec, learnerVec);
  const primaryMatch = ref.eyes.primaryZone === learner.eyes.primaryZone ? 1 : 0.5;
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
