import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface Props {
  pitchContour: number[];
  volumeContour: number[];
}

export default function SoundContourChart({ pitchContour, volumeContour }: Props) {
  const data = pitchContour.map((p, i) => ({
    t: i,
    pitch: Math.round(p),
    volume: Math.round((volumeContour[i] ?? 0) * 100),
  }));

  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 16%)" />
        <XAxis dataKey="t" tick={{ fill: 'hsl(215, 14%, 50%)', fontSize: 9 }} tickLine={false} axisLine={false} label={{ value: 'Time', position: 'insideBottomRight', offset: -4, fill: 'hsl(215, 14%, 40%)', fontSize: 10 }} />
        <YAxis yAxisId="pitch" tick={{ fill: 'hsl(215, 14%, 50%)', fontSize: 9 }} tickLine={false} axisLine={false} />
        <YAxis yAxisId="vol" orientation="right" domain={[0, 100]} tick={{ fill: 'hsl(215, 14%, 50%)', fontSize: 9 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ background: 'hsl(220, 18%, 10%)', border: '1px solid hsl(220, 14%, 18%)', borderRadius: 8, fontSize: 12 }}
        />
        <Line yAxisId="pitch" type="monotone" dataKey="pitch" name="Pitch (Hz)" stroke="hsl(0, 84%, 60%)" strokeWidth={2} dot={false} />
        <Line yAxisId="vol" type="monotone" dataKey="volume" name="Volume %" stroke="hsl(0, 60%, 45%)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
      </LineChart>
    </ResponsiveContainer>
  );
}
