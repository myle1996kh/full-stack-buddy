import { useState } from 'react';
import type { PoseLandmarkSnapshot } from '@/engine/detection/mseDetector';
import type { PoseLabel } from '@/engine/detection/motionDetector';

const POSE_COLORS: Record<PoseLabel, string> = {
  still: 'hsl(220, 9%, 46%)',
  subtle: 'hsl(48, 96%, 53%)',
  gesture: 'hsl(160, 59%, 42%)',
  movement: 'hsl(25, 95%, 53%)',
  active: 'hsl(0, 84%, 60%)',
};

// MediaPipe 33-point pose connections (simplified to major body segments)
// Using color-coded limb groups like the reference image
const CONNECTIONS: { from: number; to: number; color: string }[] = [
  // Head → spine (red)
  { from: 0, to: 1, color: 'hsl(0, 84%, 60%)' },
  // Shoulders (cyan)
  { from: 11, to: 12, color: 'hsl(180, 70%, 55%)' },
  { from: 12, to: 14, color: 'hsl(180, 70%, 55%)' },
  { from: 14, to: 16, color: 'hsl(180, 70%, 55%)' },
  { from: 11, to: 13, color: 'hsl(180, 70%, 55%)' },
  { from: 13, to: 15, color: 'hsl(180, 70%, 55%)' },
  // Torso (orange)
  { from: 11, to: 23, color: 'hsl(25, 95%, 53%)' },
  { from: 12, to: 24, color: 'hsl(25, 95%, 53%)' },
  { from: 23, to: 24, color: 'hsl(25, 95%, 53%)' },
  // Left leg (yellow)
  { from: 23, to: 25, color: 'hsl(48, 96%, 53%)' },
  { from: 25, to: 27, color: 'hsl(48, 96%, 53%)' },
  { from: 27, to: 29, color: 'hsl(48, 96%, 53%)' },
  { from: 27, to: 31, color: 'hsl(48, 96%, 53%)' },
  // Right leg (orange)
  { from: 24, to: 26, color: 'hsl(25, 95%, 53%)' },
  { from: 26, to: 28, color: 'hsl(25, 95%, 53%)' },
  { from: 28, to: 30, color: 'hsl(25, 95%, 53%)' },
  { from: 28, to: 32, color: 'hsl(25, 95%, 53%)' },
];

// Key landmark indices to label (matching the reference image style)
const LABELED_POINTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

interface Props {
  snapshots: PoseLandmarkSnapshot[];
}

export default function PoseSkeletonChart({ snapshots }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (!snapshots.length) {
    return (
      <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground">
        No pose landmarks detected (MediaPipe may not have loaded)
      </div>
    );
  }

  const snapshot = snapshots[Math.min(selectedIndex, snapshots.length - 1)];
  const lm = snapshot.landmarks;

  // SVG viewBox: landmarks are normalized 0-1
  const pad = 0.05;
  const svgW = 200;
  const svgH = 300;

  const toSvg = (x: number, y: number) => ({
    sx: pad * svgW + x * svgW * (1 - 2 * pad),
    sy: pad * svgH + y * svgH * (1 - 2 * pad),
  });

  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-background/50 border border-border/30 overflow-hidden">
        <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full max-w-[220px] mx-auto">
          {/* Grid */}
          {Array.from({ length: 7 }).map((_, i) => (
            <line key={`gv${i}`} x1={i * svgW / 6} y1={0} x2={i * svgW / 6} y2={svgH} stroke="hsl(220, 14%, 16%)" strokeWidth={0.5} />
          ))}
          {Array.from({ length: 10 }).map((_, i) => (
            <line key={`gh${i}`} x1={0} y1={i * svgH / 9} x2={svgW} y2={i * svgH / 9} stroke="hsl(220, 14%, 16%)" strokeWidth={0.5} />
          ))}

          {/* Connections */}
          {CONNECTIONS.map((c, i) => {
            if (!lm[c.from] || !lm[c.to]) return null;
            const a = toSvg(lm[c.from].x, lm[c.from].y);
            const b = toSvg(lm[c.to].x, lm[c.to].y);
            return (
              <line key={i} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke={c.color} strokeWidth={2} strokeLinecap="round" opacity={0.85} />
            );
          })}

          {/* Landmark points with labels */}
          {LABELED_POINTS.map(idx => {
            if (!lm[idx]) return null;
            const { sx, sy } = toSvg(lm[idx].x, lm[idx].y);
            return (
              <g key={idx}>
                <circle cx={sx} cy={sy} r={4} fill="hsl(220, 14%, 12%)" stroke="hsl(215, 14%, 70%)" strokeWidth={1} />
                <text x={sx} y={sy + 1} textAnchor="middle" dominantBaseline="central" fill="hsl(215, 14%, 90%)" fontSize={3.5} fontWeight="bold">
                  {idx}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Frame selector */}
      {snapshots.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">Frame</span>
          <div className="flex gap-1 flex-wrap">
            {snapshots.map((s, i) => (
              <button
                key={i}
                onClick={() => setSelectedIndex(i)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-mono border transition-colors ${
                  i === selectedIndex
                    ? 'bg-mse-motion/20 border-mse-motion text-mse-motion'
                    : 'border-border/30 text-muted-foreground hover:border-mse-motion/50'
                }`}
              >
                #{s.frameIndex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Current pose label */}
      <div className="flex items-center gap-2 text-[10px]">
        <div className="w-2 h-2 rounded-sm" style={{ background: POSE_COLORS[snapshot.pose] }} />
        <span className="text-muted-foreground">Pose:</span>
        <span className="font-medium capitalize" style={{ color: POSE_COLORS[snapshot.pose] }}>{snapshot.pose}</span>
        <span className="text-muted-foreground ml-auto">{snapshots.length} snapshots captured</span>
      </div>
    </div>
  );
}
