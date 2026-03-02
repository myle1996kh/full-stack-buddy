import { Activity, Volume2, Eye, Drum, AudioWaveform } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Cell } from 'recharts';
import type { MSEPattern } from '@/engine/detection/mseDetector';
import type { SoundEventLabel } from '@/engine/detection/audioAnalyzer';

const EVENT_COLORS: Record<SoundEventLabel, string> = {
  silence: 'hsl(var(--muted-foreground))',
  voice: 'hsl(var(--mse-sound))',
  clap: 'hsl(48, 96%, 53%)',
  snap: 'hsl(280, 70%, 60%)',
  slap: 'hsl(25, 95%, 53%)',
  stomp: 'hsl(160, 59%, 42%)',
  percussion: 'hsl(var(--primary))',
  unknown: 'hsl(var(--muted-foreground))',
};

const EVENT_ICONS: Record<string, string> = {
  clap: '👏', snap: '🫰', slap: '🤚', stomp: '🦶', voice: '🗣️', percussion: '🥁', silence: '🔇', unknown: '❓',
};

interface Props {
  pattern: MSEPattern;
}

export default function ReviewSoundSection({ pattern }: Props) {
  const sound = pattern.sound;

  // Pitch + Volume chart data
  const soundData = sound.pitchContour.map((p, i) => ({
    t: i,
    pitch: Math.round(p),
    volume: Math.round((sound.volumeContour[i] ?? 0)),
  }));

  // Spectral chart data
  const spectralData = (sound.spectralCentroidContour ?? []).map((c, i) => ({
    t: i,
    centroid: Math.round(c),
    zcr: Math.round((sound.spectralZcrContour?.[i] ?? 0) * 1000),
    rolloff: Math.round(sound.spectralRolloffContour?.[i] ?? 0),
  }));

  // Event summary bar data
  const eventLabels: SoundEventLabel[] = ['voice', 'clap', 'snap', 'slap', 'stomp', 'percussion'];
  const eventData = eventLabels
    .map(label => ({
      label: EVENT_ICONS[label] + ' ' + label,
      count: sound.eventSummary?.[label] ?? 0,
      color: EVENT_COLORS[label],
    }))
    .filter(d => d.count > 0);

  // Onset timeline
  const onsetMarkers = sound.onsetTimestamps ?? [];

  const chartTooltipStyle = {
    background: 'hsl(220, 18%, 10%)',
    border: '1px solid hsl(220, 14%, 18%)',
    borderRadius: 8,
    fontSize: 11,
  };
  const tickStyle = { fill: 'hsl(215, 14%, 50%)', fontSize: 8 };

  return (
    <div className="p-3 rounded-lg bg-muted/30 border-l-2 border-mse-sound space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <Volume2 className="w-4 h-4 text-mse-sound" />
        <span className="font-medium">Sound</span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        <span>Pitch: {sound.avgPitch}Hz</span>
        <span>Volume: {sound.avgVolume}</span>
        <span>Rate: {sound.syllableRate}/s</span>
      </div>

      {/* New: Spectral & Onset stats */}
      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        <span>Centroid: {sound.avgCentroid ?? 0}Hz</span>
        <span>ZCR: {(sound.avgZcr ?? 0).toFixed(3)}</span>
        <span>BPM: {sound.beatsPerMinute ?? 0}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <span>Onsets: {sound.onsetCount ?? 0}</span>
        <span>Events: {(sound.events?.length ?? 0)} detected</span>
      </div>

      {/* Pitch + Volume line chart */}
      {soundData.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground mb-1">Pitch & Volume Contour</p>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={soundData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 16%)" />
              <XAxis dataKey="t" tick={tickStyle} tickLine={false} axisLine={false} />
              <YAxis yAxisId="pitch" tick={tickStyle} tickLine={false} axisLine={false} />
              <YAxis yAxisId="vol" orientation="right" domain={[0, 100]} tick={tickStyle} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={chartTooltipStyle} />
              <Line yAxisId="pitch" type="monotone" dataKey="pitch" name="Pitch Hz" stroke="hsl(0, 84%, 60%)" strokeWidth={1.5} dot={false} />
              <Line yAxisId="vol" type="monotone" dataKey="volume" name="Volume" stroke="hsl(0, 60%, 45%)" strokeWidth={1} dot={false} strokeDasharray="3 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Spectral Fingerprint chart */}
      {spectralData.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
            <AudioWaveform className="w-3 h-3" /> Spectral Fingerprint
          </p>
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={spectralData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 16%)" />
              <XAxis dataKey="t" tick={tickStyle} tickLine={false} axisLine={false} />
              <YAxis tick={tickStyle} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={chartTooltipStyle} />
              <Line type="monotone" dataKey="centroid" name="Centroid Hz" stroke="hsl(38, 92%, 50%)" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="zcr" name="ZCR ×1000" stroke="hsl(280, 70%, 60%)" strokeWidth={1} dot={false} strokeDasharray="3 2" />
              <Line type="monotone" dataKey="rolloff" name="Rolloff Hz" stroke="hsl(160, 59%, 42%)" strokeWidth={1} dot={false} strokeDasharray="5 3" />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-3 mt-1 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1"><div className="w-3 h-0.5 rounded" style={{ background: 'hsl(38, 92%, 50%)' }} /> Centroid</div>
            <div className="flex items-center gap-1"><div className="w-3 h-0.5 rounded border-dashed" style={{ background: 'hsl(280, 70%, 60%)' }} /> ZCR</div>
            <div className="flex items-center gap-1"><div className="w-3 h-0.5 rounded" style={{ background: 'hsl(160, 59%, 42%)' }} /> Rolloff</div>
          </div>
        </div>
      )}

      {/* Onset/Beat Timeline */}
      {onsetMarkers.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
            <Drum className="w-3 h-3" /> Beat Timeline ({onsetMarkers.length} onsets · ~{sound.beatsPerMinute} BPM)
          </p>
          <div className="relative h-6 rounded bg-muted/50 overflow-hidden">
            {onsetMarkers.map((ms, i) => {
              const totalMs = pattern.duration * 1000;
              const pos = totalMs > 0 ? (ms / totalMs) * 100 : 0;
              return (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 w-0.5 bg-mse-sound/80"
                  style={{ left: `${pos}%` }}
                  title={`${(ms / 1000).toFixed(2)}s`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Sound Event Labels */}
      {eventData.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground mb-1">Detected Sound Events</p>
          <div className="flex flex-wrap gap-2">
            {eventData.map((d, i) => (
              <div
                key={i}
                className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border"
                style={{ borderColor: d.color, color: d.color, background: `${d.color}15` }}
              >
                {d.label}
                <span className="font-mono text-[9px] opacity-70">×{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Event Timeline (first 30 events) */}
      {(sound.events?.length ?? 0) > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground mb-1">Event Sequence</p>
          <div className="flex flex-wrap gap-1">
            {sound.events!.slice(0, 30).filter(e => e.label !== 'silence').map((e, i) => (
              <div
                key={i}
                className="px-1.5 py-0.5 rounded text-[9px] font-mono border"
                style={{
                  borderColor: EVENT_COLORS[e.label] + '40',
                  background: EVENT_COLORS[e.label] + '15',
                  color: EVENT_COLORS[e.label],
                }}
                title={`${e.label} (${e.confidence}) @ frame ${e.frameIndex}`}
              >
                {EVENT_ICONS[e.label] ?? '?'} {e.confidence === 'ai' ? '✦' : ''}
              </div>
            ))}
          </div>
          <p className="text-[9px] text-muted-foreground mt-1">
            ✦ = AI classified · plain = heuristic
          </p>
        </div>
      )}

      <div className="flex gap-3 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-mse-sound rounded" /> Pitch</div>
        <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-mse-sound/50 rounded" /> Volume</div>
      </div>
    </div>
  );
}
