/**
 * Eyes V2 Pattern Extractor — aggregate EyesFrameV2[] into EyesPatternV2.
 *
 * Follows the same approach as Sound/Motion V2 pattern extractors:
 * - Resample gaze contours to fixed length
 * - Detect attention segments (focused/scanning/away)
 * - Compute statistics and head pose profile
 */

import type {
  EyesFrameV2,
  EyesPatternV2,
  AttentionSegment,
  AttentionType,
} from './types';
import { CONTOUR_LENGTH } from './types';

// ── Resampling ──

function resampleArray(arr: number[], targetLen: number): number[] {
  if (arr.length === 0) return new Array(targetLen).fill(0);
  if (arr.length === 1) return new Array(targetLen).fill(arr[0]);
  const result: number[] = [];
  for (let i = 0; i < targetLen; i++) {
    const pos = (i / (targetLen - 1)) * (arr.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, arr.length - 1);
    const frac = pos - lo;
    result.push(arr[lo] * (1 - frac) + arr[hi] * frac);
  }
  return result;
}

// ── Attention segment detection ──

/**
 * Classify a frame's attention type:
 * - 'away': face not detected
 * - 'scanning': rapid gaze movement (high gaze velocity)
 * - 'focused': stable gaze
 */
function classifyAttention(
  frame: EyesFrameV2,
  prevFrame: EyesFrameV2 | null,
): AttentionType {
  if (!frame.faceDetected) return 'away';
  if (!prevFrame || !prevFrame.faceDetected) return 'focused';

  const gazeVelocity = Math.sqrt(
    (frame.gazeX - prevFrame.gazeX) ** 2 +
      (frame.gazeY - prevFrame.gazeY) ** 2,
  );

  // High gaze velocity = scanning
  return gazeVelocity > 0.08 ? 'scanning' : 'focused';
}

function detectAttentionSegments(frames: EyesFrameV2[]): AttentionSegment[] {
  if (frames.length === 0) return [];

  const segments: AttentionSegment[] = [];
  let currentType = classifyAttention(frames[0], null);
  let segStart = 0;

  for (let i = 1; i <= frames.length; i++) {
    const isEnd = i === frames.length;
    const type = !isEnd
      ? classifyAttention(frames[i], frames[i - 1])
      : currentType;
    const changed = !isEnd && type !== currentType;

    if (changed || isEnd) {
      const segFrames = frames.slice(segStart, i);
      const startTime = segFrames[0].t;
      const endTime = segFrames[segFrames.length - 1].t;

      // Most common zone in this segment
      const zoneCounts: Record<string, number> = {};
      for (const f of segFrames) {
        zoneCounts[f.zone] = (zoneCounts[f.zone] || 0) + 1;
      }
      const avgZone =
        Object.entries(zoneCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ||
        'center';

      segments.push({
        type: currentType,
        startTime,
        endTime,
        duration: endTime - startTime,
        avgZone,
      });

      if (!isEnd) {
        currentType = type;
        segStart = i;
      }
    }
  }

  return segments;
}

// ── Statistics ──

function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ── Main extraction ──

/**
 * Extract EyesPatternV2 from V2 frames.
 *
 * @param frames Extracted EyesFrameV2[] from featureExtractor
 * @param duration Total duration in seconds
 * @returns EyesPatternV2 ready for comparison
 */
export function extractEyesPatternV2(
  frames: EyesFrameV2[],
  duration?: number,
): EyesPatternV2 {
  if (frames.length === 0) {
    return emptyPattern(duration ?? 0);
  }

  const actualDuration =
    duration ?? (frames[frames.length - 1].t - frames[0].t);
  const detectedFrames = frames.filter((f) => f.faceDetected);

  // ── Gaze contours (resampled) ──
  const gazeContourX = resampleArray(
    frames.map((f) => f.gazeX),
    CONTOUR_LENGTH,
  );
  const gazeContourY = resampleArray(
    frames.map((f) => f.gazeY),
    CONTOUR_LENGTH,
  );

  // ── Zone analysis ──
  const zoneDwellCounts: Record<string, number> = {};
  const zoneSequence: string[] = [];

  for (const f of frames) {
    zoneDwellCounts[f.zone] = (zoneDwellCounts[f.zone] || 0) + 1;
    if (zoneSequence[zoneSequence.length - 1] !== f.zone) {
      zoneSequence.push(f.zone);
    }
  }

  // Normalize to percentages
  const zoneDwellTimes: Record<string, number> = {};
  for (const [zone, count] of Object.entries(zoneDwellCounts)) {
    zoneDwellTimes[zone] = count / frames.length;
  }

  // Primary zone (most time spent)
  const primaryZone =
    Object.entries(zoneDwellTimes).sort(([, a], [, b]) => b - a)[0]?.[0] ||
    'center';

  // ── Attention segments ──
  const attentionSegments = detectAttentionSegments(frames);

  const attentionCounts: Record<AttentionType, number> = {
    focused: 0,
    scanning: 0,
    away: 0,
  };
  for (const seg of attentionSegments) {
    // Weight by duration
    attentionCounts[seg.type] += seg.duration;
  }
  const totalAttnTime =
    attentionCounts.focused + attentionCounts.scanning + attentionCounts.away;
  const attentionDistribution: Record<AttentionType, number> = {
    focused: totalAttnTime > 0 ? attentionCounts.focused / totalAttnTime : 0,
    scanning: totalAttnTime > 0 ? attentionCounts.scanning / totalAttnTime : 0,
    away: totalAttnTime > 0 ? attentionCounts.away / totalAttnTime : 0,
  };

   // ── Blink analysis ──
   let blinkCount = 0;
   let inBlink = false;
   let blinkStartTime = 0;
   const blinkDurations: number[] = [];
   const blinkIntervals: number[] = [];
   let lastBlinkEndTime = 0;
   
   for (let i = 0; i < frames.length; i++) {
     const f = frames[i];
     
     if (f.blinkDetected && !inBlink) {
       // Start of a new blink
       blinkCount++;
       inBlink = true;
       blinkStartTime = f.t;
       
       // Calculate interval from previous blink
       if (lastBlinkEndTime > 0) {
         const interval = f.t - lastBlinkEndTime;
         if (interval > 0) {
           blinkIntervals.push(interval);
         }
       }
     } else if (!f.blinkDetected && inBlink) {
       // End of blink
       inBlink = false;
       const blinkDuration = f.t - blinkStartTime;
       if (blinkDuration > 0) {
         blinkDurations.push(blinkDuration);
       }
       lastBlinkEndTime = f.t;
     }
   }
   
   // Handle case where blink continues to end of frames
   if (inBlink && frames.length > 0) {
     const blinkDuration = frames[frames.length - 1].t - blinkStartTime;
     if (blinkDuration > 0) {
       blinkDurations.push(blinkDuration);
     }
     // Don't count as complete blink for interval calculation
   }
   
   const blinkRate = actualDuration > 0 ? (blinkCount / actualDuration) * 60 : 0;
   
   // Calculate blink metrics
   const avgBlinkDuration = blinkDurations.length > 0 
     ? blinkDurations.reduce((sum, d) => sum + d, 0) / blinkDurations.length 
     : 0;
   const blinkDurationStdDev = blinkDurations.length > 1
     ? computeStdDev(blinkDurations)
     : 0;
   // Calculate rate variability (coefficient of variation of inter-blink intervals)
   const rateVariability = blinkIntervals.length > 1
     ? (computeStdDev(blinkIntervals) / (blinkIntervals.reduce((a, b) => a + b, 0) / blinkIntervals.length))
     : 0;

  // ── Fixation duration ──
  // Average time between zone transitions
  const avgFixationDuration =
    zoneSequence.length > 1
      ? actualDuration / zoneSequence.length
      : actualDuration;

  // ── Head pose profile ──
  const yaws = detectedFrames.map((f) => f.headYaw);
  const pitches = detectedFrames.map((f) => f.headPitch);
  const avgYaw =
    yaws.length > 0 ? yaws.reduce((a, b) => a + b, 0) / yaws.length : 0;
  const avgPitch =
    pitches.length > 0
      ? pitches.reduce((a, b) => a + b, 0) / pitches.length
      : 0;
  const yawStability = computeStdDev(yaws);
  const pitchStability = computeStdDev(pitches);

  // ── Quality ──
  const faceDetectedRatio = detectedFrames.length / frames.length;
  const avgConfidence =
    detectedFrames.length > 0
      ? detectedFrames.reduce((s, f) => s + f.quality, 0) /
        detectedFrames.length
      : 0;

   return {
     duration: actualDuration,
     gazeContourX,
     gazeContourY,
     zoneDwellTimes,
     zoneSequence,
     attentionSegments,
     attentionDistribution,
     blinkRate,
     blinkCount,
     avgFixationDuration,
     blinkMetrics: {
       avgDuration: avgBlinkDuration,
       durationStdDev: blinkDurationStdDev,
       rateVariability: rateVariability,
     },
     headPoseProfile: { avgYaw, avgPitch, yawStability, pitchStability },
     primaryZone,
     quality: { faceDetectedRatio, avgConfidence },
   };
}

function emptyPattern(duration: number): EyesPatternV2 {
  return {
    duration,
    gazeContourX: new Array(CONTOUR_LENGTH).fill(0.5),
    gazeContourY: new Array(CONTOUR_LENGTH).fill(0.5),
    zoneDwellTimes: { center: 1 },
    zoneSequence: ['center'],
    attentionSegments: [],
    attentionDistribution: { focused: 0, scanning: 0, away: 1 },
    blinkRate: 0,
    blinkCount: 0,
    avgFixationDuration: 0,
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
    primaryZone: 'center',
    quality: { faceDetectedRatio: 0, avgConfidence: 0 },
  };
}
