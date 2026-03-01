import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, Cell, ZAxis } from 'recharts';

interface GazePoint {
  x: number;
  y: number;
  z: number; // dwell time / weight
}

interface Props {
  points: GazePoint[];
  zoneDwellTimes?: Record<string, number>;
}

const ZONE_GRID = [
  { zone: 'top-left', x: 0.17, y: 0.17 },
  { zone: 'top-center', x: 0.5, y: 0.17 },
  { zone: 'top-right', x: 0.83, y: 0.17 },
  { zone: 'center-left', x: 0.17, y: 0.5 },
  { zone: 'center', x: 0.5, y: 0.5 },
  { zone: 'center-right', x: 0.83, y: 0.5 },
  { zone: 'bottom-left', x: 0.17, y: 0.83 },
  { zone: 'bottom-center', x: 0.5, y: 0.83 },
  { zone: 'bottom-right', x: 0.83, y: 0.83 },
];

export default function GazeMapChart({ points, zoneDwellTimes }: Props) {
  // If we have zone dwell times, render as zone-based heatmap
  const data = zoneDwellTimes
    ? ZONE_GRID.map(z => ({ x: z.x, y: z.y, z: (zoneDwellTimes[z.zone] ?? 0) * 100 }))
    : points;

  const maxZ = Math.max(...data.map(d => d.z), 1);

  return (
    <div className="relative">
      {/* Grid overlay labels */}
      <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none z-10 opacity-30">
        {ZONE_GRID.map(z => (
          <div key={z.zone} className="flex items-center justify-center text-[8px] text-muted-foreground border border-border/20">
            {z.zone.replace('-', '\n')}
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ScatterChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 16%)" />
          <XAxis type="number" dataKey="x" domain={[0, 1]} hide />
          <YAxis type="number" dataKey="y" domain={[0, 1]} hide reversed />
          <ZAxis type="number" dataKey="z" range={[20, 400]} />
          <Tooltip
            contentStyle={{ background: 'hsl(220, 18%, 10%)', border: '1px solid hsl(220, 14%, 18%)', borderRadius: 8, fontSize: 12 }}
            formatter={(v: number, name: string) => [name === 'z' ? `${Math.round(v)}%` : v.toFixed(2)]}
          />
          <Scatter data={data} shape="circle">
            {data.map((d, i) => (
              <Cell key={i} fill={`hsl(217, 91%, ${60 - (d.z / maxZ) * 30}%)`} fillOpacity={0.3 + (d.z / maxZ) * 0.7} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
