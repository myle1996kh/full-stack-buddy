/**
 * Web Audio-based audio analyzer for real-time pitch, volume, spectral features & onset detection.
 * Uses native Web Audio API + AnalyserNode — no external deps required.
 */

export interface SpectralFeatures {
  centroid: number;      // spectral centroid (brightness) in Hz
  zcr: number;           // zero-crossing rate (0-1 normalized)
  rolloff: number;       // spectral rolloff frequency Hz
  energy: number;        // total spectral energy
  lowBandRatio: number;  // ratio of energy in low band (0-500Hz)
  midBandRatio: number;  // ratio of energy in mid band (500-2000Hz)
  highBandRatio: number; // ratio of energy in high band (2000Hz+)
}

export type SoundEventLabel = 'silence' | 'voice' | 'clap' | 'snap' | 'slap' | 'stomp' | 'percussion' | 'unknown';

export interface AudioFrame {
  timestamp: number;
  pitch: number;           // Hz, 0 if unvoiced
  volume: number;          // 0-100 RMS-based
  frequency: number;       // dominant frequency bin
  spectral: SpectralFeatures;
  isOnset: boolean;        // true if this frame is a detected onset/beat
  heuristicLabel: SoundEventLabel;
}

export class AudioAnalyzer {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private dataArray: Float32Array<ArrayBuffer> = new Float32Array(0) as Float32Array<ArrayBuffer>;
  private frequencyArray: Uint8Array<ArrayBuffer> = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
  private frequencyFloatArray: Float32Array<ArrayBuffer> = new Float32Array(0) as Float32Array<ArrayBuffer>;

  // Onset detection state
  private prevSpectralFlux = 0;
  private fluxHistory: number[] = [];
  private readonly ONSET_THRESHOLD_MULTIPLIER = 1.8;
  private readonly ONSET_HISTORY_SIZE = 30;

  async init(stream: MediaStream): Promise<void> {
    this.audioContext = new AudioContext();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;

    this.source = this.audioContext.createMediaStreamSource(stream);
    this.source.connect(this.analyser);

    const bufLen = this.analyser.fftSize;
    const freqLen = this.analyser.frequencyBinCount;
    this.dataArray = new Float32Array(bufLen) as Float32Array<ArrayBuffer>;
    this.frequencyArray = new Uint8Array(freqLen) as Uint8Array<ArrayBuffer>;
    this.frequencyFloatArray = new Float32Array(freqLen) as Float32Array<ArrayBuffer>;
    this.fluxHistory = [];
    this.prevSpectralFlux = 0;
  }

  getFrame(): AudioFrame {
    if (!this.analyser || !this.audioContext) {
      return {
        timestamp: Date.now(), pitch: 0, volume: 0, frequency: 0,
        spectral: { centroid: 0, zcr: 0, rolloff: 0, energy: 0, lowBandRatio: 0, midBandRatio: 0, highBandRatio: 0 },
        isOnset: false, heuristicLabel: 'silence',
      };
    }

    // Time domain for volume (RMS) & ZCR
    this.analyser.getFloatTimeDomainData(this.dataArray);
    let sumSq = 0;
    let zeroCrossings = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sumSq += this.dataArray[i] * this.dataArray[i];
      if (i > 0 && ((this.dataArray[i] >= 0 && this.dataArray[i - 1] < 0) || (this.dataArray[i] < 0 && this.dataArray[i - 1] >= 0))) {
        zeroCrossings++;
      }
    }
    const rms = Math.sqrt(sumSq / this.dataArray.length);
    const volume = Math.min(100, rms * 300);
    const zcr = zeroCrossings / this.dataArray.length;

    // Frequency domain
    this.analyser.getByteFrequencyData(this.frequencyArray);
    this.analyser.getFloatFrequencyData(this.frequencyFloatArray);

    let maxVal = 0, maxIndex = 0;
    for (let i = 0; i < this.frequencyArray.length; i++) {
      if (this.frequencyArray[i] > maxVal) {
        maxVal = this.frequencyArray[i];
        maxIndex = i;
      }
    }
    const sampleRate = this.audioContext.sampleRate;
    const binWidth = sampleRate / this.analyser.fftSize;
    const frequency = maxIndex * binWidth;

    // Spectral features
    const spectral = this.computeSpectralFeatures(binWidth, sampleRate, zcr);

    // Onset detection via spectral flux
    const isOnset = this.detectOnset();

    // Pitch
    const pitch = this.detectPitchACF();

    // Heuristic label
    const heuristicLabel = this.heuristicClassify(volume, pitch, spectral, isOnset, zcr);

    return { timestamp: Date.now(), pitch, volume, frequency, spectral, isOnset, heuristicLabel };
  }

  private computeSpectralFeatures(binWidth: number, sampleRate: number, zcr: number): SpectralFeatures {
    const freqArr = this.frequencyArray;
    const numBins = freqArr.length;

    // Convert byte frequency data to linear power
    let totalEnergy = 0;
    let weightedFreqSum = 0;
    let lowEnergy = 0, midEnergy = 0, highEnergy = 0;
    const lowBinLimit = Math.floor(500 / binWidth);
    const midBinLimit = Math.floor(2000 / binWidth);

    for (let i = 0; i < numBins; i++) {
      const power = freqArr[i] / 255;
      const freq = i * binWidth;
      totalEnergy += power;
      weightedFreqSum += power * freq;

      if (i < lowBinLimit) lowEnergy += power;
      else if (i < midBinLimit) midEnergy += power;
      else highEnergy += power;
    }

    const centroid = totalEnergy > 0 ? weightedFreqSum / totalEnergy : 0;

    // Spectral rolloff (frequency below which 85% of energy is contained)
    const rolloffThreshold = totalEnergy * 0.85;
    let cumEnergy = 0;
    let rolloff = 0;
    for (let i = 0; i < numBins; i++) {
      cumEnergy += freqArr[i] / 255;
      if (cumEnergy >= rolloffThreshold) {
        rolloff = i * binWidth;
        break;
      }
    }

    const safeTotal = totalEnergy || 1;
    return {
      centroid: Math.round(centroid),
      zcr,
      rolloff: Math.round(rolloff),
      energy: Math.round(totalEnergy * 100) / 100,
      lowBandRatio: Math.round((lowEnergy / safeTotal) * 1000) / 1000,
      midBandRatio: Math.round((midEnergy / safeTotal) * 1000) / 1000,
      highBandRatio: Math.round((highEnergy / safeTotal) * 1000) / 1000,
    };
  }

  /**
   * Spectral flux onset detection: measures change in spectral energy between frames.
   * An onset is detected when the flux exceeds the running average by a multiplier.
   */
  private detectOnset(): boolean {
    const freqArr = this.frequencyArray;
    let flux = 0;
    for (let i = 0; i < freqArr.length; i++) {
      const diff = (freqArr[i] / 255) - this.prevSpectralFlux;
      if (diff > 0) flux += diff;
    }
    // Update previous
    let totalPower = 0;
    for (let i = 0; i < freqArr.length; i++) totalPower += freqArr[i] / 255;
    this.prevSpectralFlux = totalPower / freqArr.length;

    this.fluxHistory.push(flux);
    if (this.fluxHistory.length > this.ONSET_HISTORY_SIZE) {
      this.fluxHistory.shift();
    }

    const avgFlux = this.fluxHistory.reduce((a, b) => a + b, 0) / this.fluxHistory.length;
    return flux > avgFlux * this.ONSET_THRESHOLD_MULTIPLIER && flux > 0.5;
  }

  /**
   * Heuristic classification based on spectral features.
   * This provides instant on-device labels before AI classification.
   */
  private heuristicClassify(volume: number, pitch: number, spectral: SpectralFeatures, isOnset: boolean, zcr: number): SoundEventLabel {
    if (volume < 3) return 'silence';

    // Clap: high ZCR, high centroid, broadband, short onset
    if (isOnset && zcr > 0.3 && spectral.centroid > 2000 && spectral.highBandRatio > 0.3) {
      return 'clap';
    }

    // Snap: very high centroid, concentrated high-freq energy
    if (isOnset && spectral.centroid > 3000 && spectral.highBandRatio > 0.5 && volume > 15) {
      return 'snap';
    }

    // Slap/stomp: low centroid, heavy low-band, onset
    if (isOnset && spectral.centroid < 800 && spectral.lowBandRatio > 0.6) {
      return volume > 40 ? 'stomp' : 'slap';
    }

    // Generic percussion: onset but doesn't match specific patterns
    if (isOnset && volume > 20) {
      return 'percussion';
    }

    // Voice: has pitch, moderate ZCR, mid-band dominant
    if (pitch > 80 && pitch < 500 && zcr < 0.3 && spectral.midBandRatio > 0.2) {
      return 'voice';
    }

    if (volume > 5) return 'unknown';
    return 'silence';
  }

  private detectPitchACF(): number {
    if (!this.analyser || !this.audioContext) return 0;

    this.analyser.getFloatTimeDomainData(this.dataArray as Float32Array<ArrayBuffer>);
    const sampleRate = this.audioContext.sampleRate;
    const size = this.dataArray.length;

    let rms = 0;
    for (let i = 0; i < size; i++) rms += this.dataArray[i] * this.dataArray[i];
    rms = Math.sqrt(rms / size);
    if (rms < 0.01) return 0;

    const minLag = Math.floor(sampleRate / 500);
    const maxLag = Math.floor(sampleRate / 80);

    let bestCorrelation = 0;
    let bestLag = 0;

    for (let lag = minLag; lag < maxLag && lag < size; lag++) {
      let correlation = 0;
      for (let i = 0; i < size - lag; i++) {
        correlation += this.dataArray[i] * this.dataArray[i + lag];
      }
      correlation /= (size - lag);

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }

    if (bestCorrelation < 0.01 || bestLag === 0) return 0;
    return Math.round(sampleRate / bestLag);
  }

  getWaveform(): Float32Array {
    if (!this.analyser) return new Float32Array(0);
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    return data;
  }

  destroy(): void {
    this.source?.disconnect();
    this.audioContext?.close();
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
  }
}
