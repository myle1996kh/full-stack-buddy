/**
 * Web Audio-based audio analyzer for real-time pitch & volume detection.
 * No external deps required — uses native Web Audio API + AnalyserNode.
 */

export interface AudioFrame {
  timestamp: number;
  pitch: number;       // Hz, 0 if unvoiced
  volume: number;      // 0-100 RMS-based
  frequency: number;   // dominant frequency bin
}

export class AudioAnalyzer {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private dataArray: Float32Array<ArrayBuffer> = new Float32Array(0) as Float32Array<ArrayBuffer>;
  private frequencyArray: Uint8Array<ArrayBuffer> = new Uint8Array(0) as Uint8Array<ArrayBuffer>;

  async init(stream: MediaStream): Promise<void> {
    this.audioContext = new AudioContext();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;

    this.source = this.audioContext.createMediaStreamSource(stream);
    this.source.connect(this.analyser);

    this.dataArray = new Float32Array(this.analyser.fftSize) as Float32Array<ArrayBuffer>;
    this.frequencyArray = new Uint8Array(this.analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
  }

  getFrame(): AudioFrame {
    if (!this.analyser || !this.audioContext) {
      return { timestamp: Date.now(), pitch: 0, volume: 0, frequency: 0 };
    }

    // Time domain for volume (RMS)
    this.analyser.getFloatTimeDomainData(this.dataArray);
    let sumSq = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sumSq += this.dataArray[i] * this.dataArray[i];
    }
    const rms = Math.sqrt(sumSq / this.dataArray.length);
    const volume = Math.min(100, rms * 300); // scale to 0-100

    // Frequency domain for pitch
    this.analyser.getByteFrequencyData(this.frequencyArray);
    let maxVal = 0;
    let maxIndex = 0;
    for (let i = 0; i < this.frequencyArray.length; i++) {
      if (this.frequencyArray[i] > maxVal) {
        maxVal = this.frequencyArray[i];
        maxIndex = i;
      }
    }
    const frequency = maxIndex * this.audioContext.sampleRate / this.analyser.fftSize;

    // Autocorrelation-based pitch detection
    const pitch = this.detectPitchACF();

    return { timestamp: Date.now(), pitch, volume, frequency };
  }

  /**
   * Simple autocorrelation pitch detection
   */
  private detectPitchACF(): number {
    if (!this.analyser || !this.audioContext) return 0;

    this.analyser.getFloatTimeDomainData(this.dataArray as Float32Array<ArrayBuffer>);
    const sampleRate = this.audioContext.sampleRate;
    const size = this.dataArray.length;

    // Check if there's enough signal
    let rms = 0;
    for (let i = 0; i < size; i++) rms += this.dataArray[i] * this.dataArray[i];
    rms = Math.sqrt(rms / size);
    if (rms < 0.01) return 0; // too quiet

    // Autocorrelation
    const minLag = Math.floor(sampleRate / 500); // max 500Hz
    const maxLag = Math.floor(sampleRate / 80);  // min 80Hz

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
