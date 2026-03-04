import type { MSEModule, EyesFrame, EyesPattern } from '@/types/modules';

export const eyesModule: MSEModule<EyesFrame, EyesPattern> = {
  id: 'eyes',
  name: 'Eyes',
  color: 'hsl(217, 91%, 60%)',
  icon: 'Eye',

  methods: [
    {
      id: 'face-mesh-gaze',
      name: 'Face Mesh Gaze Tracking',
      description: 'MediaPipe Face detection with gaze vector estimation',
      isDefault: true,
      enabled: true,
      requires: ['camera', 'face'],
      extract: (frames: EyesFrame[]): EyesPattern => {
        const zoneDwellTimes: Record<string, number> = {};
        const zoneSequence: string[] = [];
        let blinkCount = 0;
        let totalFixation = 0;
        let fixationCount = 0;

        frames.forEach((f, i) => {
          const zone = f.zone || classifyZone(f.gazeX, f.gazeY);
          zoneDwellTimes[zone] = (zoneDwellTimes[zone] || 0) + 0.033;
          
          if (zoneSequence[zoneSequence.length - 1] !== zone) {
            zoneSequence.push(zone);
            if (fixationCount > 0) totalFixation += fixationCount * 0.033;
            fixationCount = 0;
          }
          fixationCount++;
          if (f.blinkDetected) blinkCount++;
        });

        const totalTime = frames.length * 0.033;
        const primaryZone = Object.entries(zoneDwellTimes)
          .sort(([, a], [, b]) => b - a)[0]?.[0] || 'center';

        return {
          zoneDwellTimes,
          zoneSequence,
          avgFixationDuration: fixationCount > 0 ? totalFixation / zoneSequence.length : 0,
          blinkRate: totalTime > 0 ? (blinkCount / totalTime) * 60 : 0,
          primaryZone,
        };
      },
      processFrame: (frame: EyesFrame): number => {
        const zone = frame.zone || classifyZone(frame.gazeX, frame.gazeY);
        return zone === 'center' ? 1.0 : zone.includes('center') ? 0.7 : 0.4;
      },
    },
    {
      id: 'head-direction',
      name: 'Head Direction Only',
      description: 'Approximate attention from head pose — no detailed gaze',
      isDefault: false,
      enabled: false,
      requires: ['camera', 'pose'],
      extract: (frames: EyesFrame[]): EyesPattern => ({
        zoneDwellTimes: { center: frames.length * 0.033 },
        zoneSequence: ['center'],
        avgFixationDuration: frames.length * 0.033,
        blinkRate: 0,
        primaryZone: 'center',
      }),
    },
  ],

  charts: [
    { id: 'gaze-heatmap', name: 'Gaze Heatmap', description: '3×3 zone time distribution', enabled: true, category: 'post-session', dataSource: 'pattern' },
    { id: 'gaze-timeline', name: 'Gaze Timeline', description: 'Zone colors over time', enabled: true, category: 'both', dataSource: 'frames' },
    { id: 'focus-ring', name: 'Focus Ring', description: 'Circular gauge of focus stability', enabled: false, category: 'realtime', dataSource: 'frames' },
    { id: 'blink-rate', name: 'Blink Rate', description: 'Blink frequency indicator', enabled: false, category: 'realtime', dataSource: 'frames' },
  ],

  comparers: [
    {
      id: 'multi-feature',
      name: 'Multi-feature Comparison',
      description: 'Compare zone distribution, sequence, and focus quality',
      isDefault: true,
      enabled: true,
      compare: (ref: EyesPattern, learner: EyesPattern) => {
        // Zone match: compare zone dwell time distributions
        const zoneScore = compareZoneDwell(ref.zoneDwellTimes, learner.zoneDwellTimes);

        // Sequence: compare zone transition sequences
        const sequenceScore = compareZoneSequences(ref.zoneSequence, learner.zoneSequence);

        // Focus: compare fixation duration
        const focusScore = ref.avgFixationDuration > 0
          ? Math.max(0, 100 - Math.abs(ref.avgFixationDuration - learner.avgFixationDuration) / ref.avgFixationDuration * 100)
          : learner.avgFixationDuration === 0 ? 100 : 50;

        // Stability: compare blink rates
        const stabilityScore = ref.blinkRate > 0
          ? Math.max(0, 100 - Math.abs(ref.blinkRate - learner.blinkRate) / ref.blinkRate * 80)
          : learner.blinkRate === 0 ? 100 : 60;

        // Engagement: primary zone match
        const engagementScore = ref.primaryZone === learner.primaryZone ? 100 : 40;

        const overall = (zoneScore + sequenceScore + focusScore + stabilityScore + engagementScore) / 5;

        const feedback: string[] = [];
        if (zoneScore < 60) feedback.push('Gaze distribution differs from reference');
        if (sequenceScore < 60) feedback.push('Eye movement pattern is different');
        if (engagementScore < 60) feedback.push(`Try focusing more on the "${ref.primaryZone}" zone`);
        if (stabilityScore < 60) feedback.push('Blink rate differs — try to stay relaxed');
        if (overall >= 80) feedback.push('Excellent eye contact!');

        return {
          score: Math.round(overall),
          breakdown: {
            zone_match: Math.round(zoneScore),
            sequence: Math.round(sequenceScore),
            focus: Math.round(focusScore),
            stability: Math.round(stabilityScore),
            engagement: Math.round(engagementScore),
          },
          feedback,
        };
      },
    },
  ],
};

function compareZoneDwell(ref: Record<string, number>, learner: Record<string, number>): number {
  const allZones = new Set([...Object.keys(ref), ...Object.keys(learner)]);
  if (allZones.size === 0) return 100;

  const refTotal = Object.values(ref).reduce((a, b) => a + b, 0) || 1;
  const learnerTotal = Object.values(learner).reduce((a, b) => a + b, 0) || 1;

  const refVec: number[] = [];
  const learnerVec: number[] = [];
  allZones.forEach(zone => {
    refVec.push((ref[zone] || 0) / refTotal);
    learnerVec.push((learner[zone] || 0) / learnerTotal);
  });

  return cosineSimilarity(refVec, learnerVec) * 100;
}

function compareZoneSequences(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 100;
  if (a.length === 0 || b.length === 0) return 30;

  // LCS-based similarity
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return (dp[m][n] / Math.max(m, n)) * 100;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  const sim = dot / (Math.sqrt(magA) * Math.sqrt(magB));
  return Math.max(0, Math.min(1, (sim + 1) / 2));
}

function classifyZone(x: number, y: number): string {
  const col = x < 0.33 ? 'left' : x > 0.66 ? 'right' : 'center';
  const row = y < 0.33 ? 'top' : y > 0.66 ? 'bottom' : 'center';
  if (col === 'center' && row === 'center') return 'center';
  return `${row}-${col}`;
}
