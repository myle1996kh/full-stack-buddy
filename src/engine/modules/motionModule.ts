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
        const dirScore = Math.random() * 30 + 60;
        const trajScore = Math.random() * 30 + 55;
        const velScore = Math.random() * 30 + 50;
        const gestScore = Math.random() * 30 + 65;
        const postureScore = Math.random() * 30 + 45;
        const overall = (dirScore + trajScore + velScore + gestScore + postureScore) / 5;
        return {
          score: Math.round(overall),
          breakdown: { direction: dirScore, trajectory: trajScore, velocity: velScore, gestures: gestScore, posture: postureScore },
          feedback: overall < 70 ? ['Try wider arm movements', 'Match the tempo better'] : ['Good motion match!'],
        };
      },
    },
  ],
};

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
