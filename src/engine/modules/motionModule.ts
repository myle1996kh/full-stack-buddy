import type { MSEModule, MotionFrame, MotionPattern } from '@/types/modules';

export const motionModule: MSEModule<MotionFrame, MotionPattern> = {
  id: 'motion',
  name: 'Motion',
  color: 'hsl(160, 59%, 42%)',
  icon: 'Activity',

  methods: [
    {
      id: 'full-pose',
      name: 'Full Body Pose (33 landmarks)',
      description: 'MediaPipe Pose detection with 33 body landmarks for full choreography analysis',
      isDefault: true,
      enabled: true,
      requires: ['camera', 'pose'],
      extract: (frames: MotionFrame[]): MotionPattern => {
        const segments = analyzeMotionSegments(frames);
        const avgVelocity = calculateAvgVelocity(frames);
        return { segments, avgVelocity, gestureSequence: segments.map(s => s.type) };
      },
      processFrame: (frame: MotionFrame): number => {
        if (!frame.landmarks || frame.landmarks.length === 0) return 0;
        return Math.min(1, frame.landmarks.length / 33);
      },
    },
    {
      id: 'hands-only',
      name: 'Hands Only (21×2 landmarks)',
      description: 'Track hand gestures using MediaPipe Hands',
      isDefault: false,
      enabled: false,
      requires: ['camera', 'hands'],
      extract: (frames: MotionFrame[]): MotionPattern => {
        const segments = frames
          .filter(f => f.handLandmarks && f.handLandmarks.length > 0)
          .map((f, i) => ({ type: 'hand-gesture', duration: 0.1, landmarks: f.handLandmarks?.[0] || [] }));
        return { segments, avgVelocity: 0, gestureSequence: segments.map(s => s.type) };
      },
    },
    {
      id: 'upper-body',
      name: 'Upper Body (landmarks 0-22)',
      description: 'Track upper body only — good for seated/waist-up practice',
      isDefault: false,
      enabled: false,
      requires: ['camera', 'pose'],
      extract: (frames: MotionFrame[]): MotionPattern => {
        const filtered = frames.map(f => ({
          ...f,
          landmarks: f.landmarks?.slice(0, 23) || [],
        }));
        return analyzeMotionSegments(filtered).length > 0
          ? { segments: analyzeMotionSegments(filtered), avgVelocity: calculateAvgVelocity(filtered), gestureSequence: [] }
          : { segments: [], avgVelocity: 0, gestureSequence: [] };
      },
    },
  ],

  charts: [
    { id: 'skeleton-overlay', name: 'Skeleton Overlay', description: 'Live pose overlay on camera', enabled: true, category: 'realtime', dataSource: 'frames' },
    { id: 'motion-trail', name: 'Motion Trail', description: 'Hand trajectory path on canvas', enabled: true, category: 'realtime', dataSource: 'frames' },
    { id: 'movement-timeline', name: 'Movement Timeline', description: 'Segments over time', enabled: false, category: 'post-session', dataSource: 'pattern' },
    { id: 'velocity-profile', name: 'Velocity Profile', description: 'Speed over time', enabled: false, category: 'post-session', dataSource: 'pattern' },
  ],

  comparers: [
    {
      id: 'multi-dtw',
      name: 'Multi-feature DTW',
      description: 'Dynamic Time Warping across multiple body features',
      isDefault: true,
      enabled: true,
      compare: (ref: MotionPattern, learner: MotionPattern) => {
        // Direction: compare gesture sequences
        const dirScore = compareSequences(ref.gestureSequence, learner.gestureSequence);

        // Velocity: compare average velocity
        const velScore = ref.avgVelocity > 0
          ? Math.max(0, 100 - Math.abs(ref.avgVelocity - learner.avgVelocity) / ref.avgVelocity * 100)
          : learner.avgVelocity === 0 ? 100 : 50;

        // Trajectory: compare segment count and durations
        const trajScore = compareSegments(ref.segments, learner.segments);

        // Gestures: compare gesture type distribution
        const gestScore = compareGestureDistribution(ref.segments, learner.segments);

        // Posture: compare landmark positions in segments
        const postureScore = comparePosture(ref.segments, learner.segments);

        const overall = (dirScore + trajScore + velScore + gestScore + postureScore) / 5;

        const feedback: string[] = [];
        if (velScore < 60) feedback.push('Try matching the speed/tempo of the reference');
        if (trajScore < 60) feedback.push('Movement duration and flow differ significantly');
        if (postureScore < 60) feedback.push('Body positioning needs improvement');
        if (dirScore < 60) feedback.push('Movement sequence differs from reference');
        if (overall >= 80) feedback.push('Great motion match!');

        return {
          score: Math.round(overall),
          breakdown: {
            direction: Math.round(dirScore),
            trajectory: Math.round(trajScore),
            velocity: Math.round(velScore),
            gestures: Math.round(gestScore),
            posture: Math.round(postureScore),
          },
          feedback,
        };
      },
    },
  ],
};

// --- Real comparison helpers ---

function compareSequences(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 100;
  if (a.length === 0 || b.length === 0) return 30;
  // LCS-based similarity
  const lcs = longestCommonSubsequence(a, b);
  return (lcs / Math.max(a.length, b.length)) * 100;
}

function longestCommonSubsequence(a: string[], b: string[]): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function compareSegments(refSegs: MotionPattern['segments'], learnerSegs: MotionPattern['segments']): number {
  if (refSegs.length === 0 && learnerSegs.length === 0) return 100;
  if (refSegs.length === 0 || learnerSegs.length === 0) return 30;

  // Compare total duration
  const refDur = refSegs.reduce((s, seg) => s + seg.duration, 0);
  const learnerDur = learnerSegs.reduce((s, seg) => s + seg.duration, 0);
  const durScore = refDur > 0 ? Math.max(0, 100 - Math.abs(refDur - learnerDur) / refDur * 100) : 50;

  // Compare segment count similarity
  const countScore = Math.max(0, 100 - Math.abs(refSegs.length - learnerSegs.length) / Math.max(refSegs.length, learnerSegs.length) * 100);

  return (durScore + countScore) / 2;
}

function compareGestureDistribution(refSegs: MotionPattern['segments'], learnerSegs: MotionPattern['segments']): number {
  const refDist = buildDistribution(refSegs.map(s => s.type));
  const learnerDist = buildDistribution(learnerSegs.map(s => s.type));
  return cosineSimilarity(refDist, learnerDist) * 100;
}

function buildDistribution(items: string[]): Map<string, number> {
  const dist = new Map<string, number>();
  items.forEach(item => dist.set(item, (dist.get(item) || 0) + 1));
  return dist;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  const keys = new Set([...a.keys(), ...b.keys()]);
  let dotProduct = 0, magA = 0, magB = 0;
  keys.forEach(k => {
    const va = a.get(k) || 0;
    const vb = b.get(k) || 0;
    dotProduct += va * vb;
    magA += va * va;
    magB += vb * vb;
  });
  if (magA === 0 || magB === 0) return 0;
  return dotProduct / (Math.sqrt(magA) * Math.sqrt(magB));
}

function comparePosture(refSegs: MotionPattern['segments'], learnerSegs: MotionPattern['segments']): number {
  // Compare landmark positions from first segment of each
  const refLm = refSegs[0]?.landmarks;
  const learnerLm = learnerSegs[0]?.landmarks;
  if (!refLm || !learnerLm || refLm.length === 0 || learnerLm.length === 0) return 50;

  const len = Math.min(refLm.length, learnerLm.length);
  let totalDist = 0;
  for (let i = 0; i < len; i++) {
    const r = refLm[i], l = learnerLm[i];
    if (r && l && r.length >= 2 && l.length >= 2) {
      const dx = r[0] - l[0], dy = r[1] - l[1];
      totalDist += Math.sqrt(dx * dx + dy * dy);
    }
  }
  const avgDist = totalDist / len;
  // Normalize: 0 dist = 100, 0.5+ dist = 0
  return Math.max(0, Math.round(100 - avgDist * 200));
}

// --- Keep existing helpers ---

function analyzeMotionSegments(frames: MotionFrame[]) {
  if (frames.length < 2) return [];
  const segmentSize = Math.max(1, Math.floor(frames.length / 5));
  const segments = [];
  for (let i = 0; i < frames.length; i += segmentSize) {
    const chunk = frames.slice(i, i + segmentSize);
    segments.push({
      type: 'movement',
      duration: chunk.length * 0.033,
      landmarks: chunk[0]?.landmarks || [],
    });
  }
  return segments;
}

function calculateAvgVelocity(frames: MotionFrame[]): number {
  if (frames.length < 2) return 0;
  let totalVelocity = 0;
  for (let i = 1; i < frames.length; i++) {
    const dt = frames[i].timestamp - frames[i - 1].timestamp;
    if (dt > 0 && frames[i].landmarks && frames[i - 1].landmarks) {
      totalVelocity += 1 / dt;
    }
  }
  return totalVelocity / (frames.length - 1);
}
