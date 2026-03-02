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

// Body connections grouped by limb for color-coded rendering
const CONNECTIONS: { from: number; to: number; group: string }[] = [
  // Torso
  { from: 11, to: 12, group: 'torso' },
  { from: 11, to: 23, group: 'torso' },
  { from: 12, to: 24, group: 'torso' },
  { from: 23, to: 24, group: 'torso' },
  // Left arm
  { from: 11, to: 13, group: 'leftArm' },
  { from: 13, to: 15, group: 'leftArm' },
  // Right arm
  { from: 12, to: 14, group: 'rightArm' },
  { from: 14, to: 16, group: 'rightArm' },
  // Left leg
  { from: 23, to: 25, group: 'leftLeg' },
  { from: 25, to: 27, group: 'leftLeg' },
  // Right leg
  { from: 24, to: 26, group: 'rightLeg' },
  { from: 26, to: 28, group: 'rightLeg' },
  // Head
  { from: 0, to: 11, group: 'head' },
  { from: 0, to: 12, group: 'head' },
];

const GROUP_COLORS: Record<string, string> = {
  torso: 'hsl(var(--muted-foreground))',
  leftArm: 'hsl(var(--mse-eyes))',
  rightArm: 'hsl(var(--mse-motion))',
  leftLeg: 'hsl(var(--score-yellow))',
  rightLeg: 'hsl(var(--score-orange))',
  head: 'hsl(var(--mse-sound))',
};

const JOINT_POINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

interface Props {
  snapshots: PoseLandmarkSnapshot[];
  /** If provided, the first cell shows a camera frame label */
  showCameraLabel?: boolean;
}

function SkeletonCell({ snapshot, index, selected, onClick }: {
  snapshot: PoseLandmarkSnapshot;
  index: number;
  selected: boolean;
  onClick: () => void;
}) {
  const lm = snapshot.landmarks;
  const svgSize = 120;
  const pad = 0.12;

  const toSvg = (x: number, y: number) => ({
    sx: pad * svgSize + x * svgSize * (1 - 2 * pad),
    sy: pad * svgSize + y * svgSize * (1 - 2 * pad),
  });

  return (
    <button
      onClick={onClick}
      className={`relative rounded-lg border-2 transition-all aspect-square ${
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border/40 bg-muted/20 hover:border-primary/40'
      }`}
    >
      {/* Frame number */}
      <span className={`absolute top-1 right-1.5 text-[10px] font-bold ${
        selected ? 'text-primary' : 'text-muted-foreground'
      }`}>
        {index + 1}
      </span>

      <svg viewBox={`0 0 ${svgSize} ${svgSize}`} className="w-full h-full">
        {/* Fill body silhouette */}
        {(() => {
          // Create a rough body silhouette polygon
          const bodyPoints = [11, 12, 24, 23]; // torso
          const coords = bodyPoints
            .filter(i => lm[i])
            .map(i => toSvg(lm[i].x, lm[i].y));
          if (coords.length === 4) {
            return (
              <polygon
                points={coords.map(c => `${c.sx},${c.sy}`).join(' ')}
                fill="hsl(var(--muted-foreground))"
                opacity={0.15}
              />
            );
          }
          return null;
        })()}

        {/* Connections */}
        {CONNECTIONS.map((c, i) => {
          if (!lm[c.from] || !lm[c.to]) return null;
          const a = toSvg(lm[c.from].x, lm[c.from].y);
          const b = toSvg(lm[c.to].x, lm[c.to].y);
          return (
            <line
              key={i}
              x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy}
              stroke={GROUP_COLORS[c.group]}
              strokeWidth={3}
              strokeLinecap="round"
              opacity={0.9}
            />
          );
        })}

        {/* Joint dots */}
        {JOINT_POINTS.map(idx => {
          if (!lm[idx]) return null;
          const { sx, sy } = toSvg(lm[idx].x, lm[idx].y);
          return (
            <circle
              key={idx}
              cx={sx} cy={sy} r={3}
              fill="hsl(var(--foreground))"
              opacity={0.7}
            />
          );
        })}

        {/* Head circle */}
        {lm[0] && (() => {
          const { sx, sy } = toSvg(lm[0].x, lm[0].y);
          return <circle cx={sx} cy={sy} r={8} fill="hsl(var(--muted-foreground))" opacity={0.3} stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} />;
        })()}
      </svg>
    </button>
  );
}

export default function PoseSkeletonChart({ snapshots, showCameraLabel }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (!snapshots.length) {
    return (
      <div className="flex items-center justify-center h-[100px] text-xs text-muted-foreground">
        No pose landmarks detected (MediaPipe may not have loaded)
      </div>
    );
  }

  const selected = snapshots[Math.min(selectedIndex, snapshots.length - 1)];
  // Show up to 8 snapshots in a 4-column grid (2 rows)
  const cols = Math.min(4, snapshots.length);

  return (
    <div className="space-y-2">
      {/* Keyframe grid */}
      <div className={`grid gap-1.5`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {snapshots.map((snap, i) => (
          <SkeletonCell
            key={i}
            snapshot={snap}
            index={i}
            selected={i === selectedIndex}
            onClick={() => setSelectedIndex(i)}
          />
        ))}
      </div>

      {/* Info bar */}
      <div className="flex items-center gap-2 text-[10px] flex-wrap">
        <div className="w-2 h-2 rounded-sm" style={{ background: POSE_COLORS[selected.pose] }} />
        <span className="text-muted-foreground">Pose:</span>
        <span className="font-medium capitalize" style={{ color: POSE_COLORS[selected.pose] }}>{selected.pose}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">Frame #{selected.frameIndex}</span>
        <span className="text-muted-foreground ml-auto">{snapshots.length} keyframes</span>
      </div>
    </div>
  );
}
