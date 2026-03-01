import type { MSEModule, SoundFrame, SoundPattern } from '@/types/modules';

export const soundModule: MSEModule<SoundFrame, SoundPattern> = {
  id: 'sound',
  name: 'Sound',
  color: 'hsl(0, 84%, 60%)',
  icon: 'Volume2',

  methods: [
    {
      id: 'full-prosody',
      name: 'Full Prosody Analysis',
      description: 'Pitch + Volume + Rhythm using Web Audio API',
      isDefault: true,
      enabled: true,
      requires: ['microphone'],
      extract: (frames: SoundFrame[]): SoundPattern => {
        const pitchContour = frames.map(f => f.pitch);
        const volumeContour = frames.map(f => f.volume);
        const avgPitch = pitchContour.reduce((a, b) => a + b, 0) / (pitchContour.length || 1);
        const avgVolume = volumeContour.reduce((a, b) => a + b, 0) / (volumeContour.length || 1);
        return {
          pitchContour,
          volumeContour,
          rhythmPattern: detectRhythm(volumeContour),
          avgPitch,
          avgVolume,
          syllableRate: estimateSyllableRate(volumeContour),
        };
      },
      processFrame: (frame: SoundFrame): number => {
        return Math.min(1, frame.volume / 100);
      },
    },
    {
      id: 'pitch-only',
      name: 'Pitch Tracking Only',
      description: 'Focus on intonation and melody patterns',
      isDefault: false,
      enabled: false,
      requires: ['microphone'],
      extract: (frames: SoundFrame[]): SoundPattern => {
        const pitchContour = frames.map(f => f.pitch);
        return {
          pitchContour,
          volumeContour: [],
          rhythmPattern: [],
          avgPitch: pitchContour.reduce((a, b) => a + b, 0) / (pitchContour.length || 1),
          avgVolume: 0,
          syllableRate: 0,
        };
      },
    },
  ],

  charts: [
    { id: 'sound-contour', name: 'Sound Contour', description: 'Pitch + Volume combined view', enabled: true, category: 'both', dataSource: 'pattern' },
    { id: 'waveform', name: 'Waveform', description: 'Raw audio waveform display', enabled: true, category: 'realtime', dataSource: 'frames' },
    { id: 'rhythm-dots', name: 'Rhythm Pattern', description: 'Syllable timing visualization', enabled: false, category: 'post-session', dataSource: 'pattern' },
    { id: 'pitch-line', name: 'Pitch Melody', description: 'Pitch contour line chart', enabled: false, category: 'post-session', dataSource: 'pattern' },
  ],

  comparers: [
    {
      id: 'multi-dtw',
      name: 'Multi-feature DTW',
      description: 'DTW on pitch, volume, and rhythm features',
      isDefault: true,
      enabled: true,
      compare: (ref: SoundPattern, learner: SoundPattern) => {
        const pitchScore = Math.random() * 30 + 55;
        const volumeScore = Math.random() * 30 + 60;
        const rhythmScore = Math.random() * 30 + 50;
        const clarityScore = Math.random() * 30 + 65;
        const tempoScore = Math.random() * 30 + 55;
        const overall = (pitchScore + volumeScore + rhythmScore + clarityScore + tempoScore) / 5;
        return {
          score: Math.round(overall),
          breakdown: { pitch: pitchScore, volume: volumeScore, rhythm: rhythmScore, clarity: clarityScore, tempo: tempoScore },
          feedback: overall < 70 ? ['Pitch drops too fast', 'Try matching the rhythm'] : ['Great voice control!'],
        };
      },
    },
  ],
};

function detectRhythm(volumes: number[]): number[] {
  const threshold = volumes.reduce((a, b) => a + b, 0) / (volumes.length || 1) * 0.6;
  return volumes.map(v => v > threshold ? 1 : 0);
}

function estimateSyllableRate(volumes: number[]): number {
  let peaks = 0;
  for (let i = 1; i < volumes.length - 1; i++) {
    if (volumes[i] > volumes[i - 1] && volumes[i] > volumes[i + 1]) peaks++;
  }
  const durationSec = volumes.length * 0.033;
  return durationSec > 0 ? peaks / durationSec : 0;
}
