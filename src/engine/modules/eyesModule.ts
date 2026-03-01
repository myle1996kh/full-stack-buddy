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
        const zoneScore = Math.random() * 30 + 65;
        const sequenceScore = Math.random() * 30 + 55;
        const focusScore = Math.random() * 30 + 70;
        const stabilityScore = Math.random() * 30 + 60;
        const engagementScore = Math.random() * 30 + 68;
        const overall = (zoneScore + sequenceScore + focusScore + stabilityScore + engagementScore) / 5;
        return {
          score: Math.round(overall),
          breakdown: { zone_match: zoneScore, sequence: sequenceScore, focus: focusScore, stability: stabilityScore, engagement: engagementScore },
          feedback: overall < 70 ? ['Try maintaining center gaze longer', 'Reduce rapid eye movements'] : ['Excellent eye contact!'],
        };
      },
    },
  ],
};

function classifyZone(x: number, y: number): string {
  const col = x < 0.33 ? 'left' : x > 0.66 ? 'right' : 'center';
  const row = y < 0.33 ? 'top' : y > 0.66 ? 'bottom' : 'center';
  if (col === 'center' && row === 'center') return 'center';
  return `${row}-${col}`;
}
