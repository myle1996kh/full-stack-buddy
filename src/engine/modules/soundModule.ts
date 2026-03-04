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
        const pitchScore = compareContours(ref.pitchContour, learner.pitchContour);
        const volumeScore = compareContours(ref.volumeContour, learner.volumeContour);
        const rhythmScore = compareContours(ref.rhythmPattern, learner.rhythmPattern);

        // Clarity: compare avg pitch similarity
        const clarityScore = ref.avgPitch > 0
          ? Math.max(0, 100 - Math.abs(ref.avgPitch - learner.avgPitch) / ref.avgPitch * 100)
          : learner.avgPitch === 0 ? 100 : 50;

        // Tempo: compare syllable rate
        const tempoScore = ref.syllableRate > 0
          ? Math.max(0, 100 - Math.abs(ref.syllableRate - learner.syllableRate) / ref.syllableRate * 100)
          : learner.syllableRate === 0 ? 100 : 50;

        const overall = (pitchScore + volumeScore + rhythmScore + clarityScore + tempoScore) / 5;

        const feedback: string[] = [];
        if (pitchScore < 60) feedback.push('Pitch contour differs — try matching the intonation pattern');
        if (volumeScore < 60) feedback.push('Volume dynamics need adjustment');
        if (rhythmScore < 60) feedback.push('Rhythm pattern is off — focus on timing');
        if (tempoScore < 60) feedback.push('Speaking rate differs from reference');
        if (overall >= 80) feedback.push('Great voice control!');

        return {
          score: Math.round(overall),
          breakdown: {
            pitch: Math.round(pitchScore),
            volume: Math.round(volumeScore),
            rhythm: Math.round(rhythmScore),
            clarity: Math.round(clarityScore),
            tempo: Math.round(tempoScore),
          },
          feedback,
        };
      },
    },
  ],
};

// --- Real comparison helpers ---

function compareContours(a: number[], b: number[]): number {
  if (a.length === 0 && b.length === 0) return 100;
  if (a.length === 0 || b.length === 0) return 30;

  // Resample both to same length, then cosine similarity
  const len = 64;
  const ra = resample(a, len);
  const rb = resample(b, len);
  return cosineSimilarity(ra, rb) * 100;
}

function resample(arr: number[], targetLen: number): number[] {
  if (arr.length === 0) return new Array(targetLen).fill(0);
  if (arr.length === targetLen) return arr;
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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  const sim = dot / (Math.sqrt(magA) * Math.sqrt(magB));
  // Cosine sim ranges -1 to 1, normalize to 0-1
  return Math.max(0, Math.min(1, (sim + 1) / 2));
}

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
