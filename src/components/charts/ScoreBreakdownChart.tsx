import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid } from 'recharts';

interface Props {
  motion: number;
  sound: number;
  eyes: number;
  consciousness: number;
}

const ITEMS = [
  { key: 'motion', label: 'Motion', color: 'hsl(160, 59%, 42%)' },
  { key: 'sound', label: 'Sound', color: 'hsl(0, 84%, 60%)' },
  { key: 'eyes', label: 'Eyes', color: 'hsl(217, 91%, 60%)' },
  { key: 'consciousness', label: 'MSE', color: 'hsl(38, 92%, 50%)' },
];

export default function ScoreBreakdownChart({ motion, sound, eyes, consciousness }: Props) {
  const data = ITEMS.map(it => ({ ...it, value: ({ motion, sound, eyes, consciousness } as Record<string, number>)[it.key] }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke="hsl(220, 14%, 16%)" />
        <XAxis type="number" domain={[0, 100]} tick={{ fill: 'hsl(215, 14%, 50%)', fontSize: 10 }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="label" tick={{ fill: 'hsl(215, 14%, 50%)', fontSize: 11 }} tickLine={false} axisLine={false} width={60} />
        <Tooltip
          contentStyle={{ background: 'hsl(220, 18%, 10%)', border: '1px solid hsl(220, 14%, 18%)', borderRadius: 8, fontSize: 12 }}
          formatter={(v: number) => [`${Math.round(v)}%`]}
        />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={18}>
          {data.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.85} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
