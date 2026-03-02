/**
 * Client-side sound classifier that batches spectral snapshots
 * and sends them to the AI classification edge function.
 */

import type { AudioFrame, SoundEventLabel } from './audioAnalyzer';

interface SpectralSnapshot {
  centroid: number;
  zcr: number;
  rolloff: number;
  energy: number;
  lowBandRatio: number;
  midBandRatio: number;
  highBandRatio: number;
  volume: number;
  pitch: number;
  isOnset: boolean;
  heuristicLabel: string;
}

export interface SoundEvent {
  timestamp: number;
  label: SoundEventLabel;
  confidence: 'heuristic' | 'ai';
  frameIndex: number;
}

export class SoundClassifier {
  private pendingSnapshots: { snapshot: SpectralSnapshot; timestamp: number; frameIndex: number }[] = [];
  private events: SoundEvent[] = [];
  private batchSize = 20;
  private classifyUrl: string;
  private classifying = false;

  constructor() {
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    this.classifyUrl = `https://${projectId}.supabase.co/functions/v1/classify-sound`;
  }

  /**
   * Add a frame for classification. Onset frames are prioritized.
   * Heuristic labels are stored immediately; AI labels update asynchronously.
   */
  addFrame(frame: AudioFrame, frameIndex: number): void {
    // Always store heuristic event for onset frames
    if (frame.isOnset || frame.heuristicLabel !== 'silence') {
      this.events.push({
        timestamp: frame.timestamp,
        label: frame.heuristicLabel,
        confidence: 'heuristic',
        frameIndex,
      });
    }

    // Only batch onset/non-silence frames for AI classification
    if (frame.isOnset || (frame.heuristicLabel !== 'silence' && frame.volume > 10)) {
      this.pendingSnapshots.push({
        snapshot: {
          centroid: frame.spectral.centroid,
          zcr: frame.spectral.zcr,
          rolloff: frame.spectral.rolloff,
          energy: frame.spectral.energy,
          lowBandRatio: frame.spectral.lowBandRatio,
          midBandRatio: frame.spectral.midBandRatio,
          highBandRatio: frame.spectral.highBandRatio,
          volume: frame.volume,
          pitch: frame.pitch,
          isOnset: frame.isOnset,
          heuristicLabel: frame.heuristicLabel,
        },
        timestamp: frame.timestamp,
        frameIndex,
      });

      if (this.pendingSnapshots.length >= this.batchSize && !this.classifying) {
        this.classifyBatch();
      }
    }
  }

  /**
   * Force classify remaining snapshots (call at end of session).
   */
  async flush(): Promise<void> {
    if (this.pendingSnapshots.length > 0) {
      await this.classifyBatch();
    }
  }

  private async classifyBatch(): Promise<void> {
    if (this.pendingSnapshots.length === 0 || this.classifying) return;
    this.classifying = true;

    const batch = this.pendingSnapshots.splice(0, this.batchSize);

    try {
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const resp = await fetch(this.classifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          snapshots: batch.map(b => b.snapshot),
        }),
      });

      if (resp.ok) {
        const { labels } = await resp.json() as { labels: string[] };
        // Update events with AI labels
        labels.forEach((label, i) => {
          if (i < batch.length) {
            const validLabel = label as SoundEventLabel;
            // Find matching event and upgrade confidence
            const existing = this.events.find(
              e => e.frameIndex === batch[i].frameIndex && e.confidence === 'heuristic'
            );
            if (existing) {
              existing.label = validLabel;
              existing.confidence = 'ai';
            } else {
              this.events.push({
                timestamp: batch[i].timestamp,
                label: validLabel,
                confidence: 'ai',
                frameIndex: batch[i].frameIndex,
              });
            }
          }
        });
      }
    } catch (err) {
      console.warn('Sound classification failed, using heuristic labels:', err);
    } finally {
      this.classifying = false;
    }
  }

  getEvents(): SoundEvent[] {
    return [...this.events];
  }

  /**
   * Get event summary: count of each label type
   */
  getSummary(): Record<SoundEventLabel, number> {
    const summary: Record<SoundEventLabel, number> = {
      silence: 0, voice: 0, clap: 0, snap: 0, slap: 0, stomp: 0, percussion: 0, unknown: 0,
    };
    this.events.forEach(e => { summary[e.label]++; });
    return summary;
  }

  reset(): void {
    this.pendingSnapshots = [];
    this.events = [];
  }
}
