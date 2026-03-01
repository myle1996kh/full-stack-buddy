import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';

interface TrendPoint {
  label: string;
  consciousness: number;
  motion: number;
  sound: number;
  eyes: number;
}

interface Props {
  data: TrendPoint[];
}

export default function ConsciousnessTrendChart({ data }: Props) {
  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="gradMotion" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(160, 59%, 42%)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="hsl(160, 59%, 42%)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradSound" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradEyes" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 16%)" />
        <XAxis dataKey="label" tick={{ fill: 'hsl(215, 14%, 50%)', fontSize: 10 }} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} tick={{ fill: 'hsl(215, 14%, 50%)', fontSize: 10 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ background: 'hsl(220, 18%, 10%)', border: '1px solid hsl(220, 14%, 18%)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: 'hsl(210, 20%, 92%)' }}
        />
        <ReferenceLine y={60} stroke="hsl(38, 92%, 50%)" strokeDasharray="4 4" strokeOpacity={0.5} />
        <Area type="monotone" dataKey="motion" name="Motion" stroke="hsl(160, 59%, 42%)" fill="url(#gradMotion)" strokeWidth={2} dot={false} />
        <Area type="monotone" dataKey="sound" name="Sound" stroke="hsl(0, 84%, 60%)" fill="url(#gradSound)" strokeWidth={2} dot={false} />
        <Area type="monotone" dataKey="eyes" name="Eyes" stroke="hsl(217, 91%, 60%)" fill="url(#gradEyes)" strokeWidth={2} dot={false} />
        <Area type="monotone" dataKey="consciousness" name="Consciousness" stroke="hsl(38, 92%, 50%)" fill="none" strokeWidth={2.5} dot={{ r: 3, fill: 'hsl(38, 92%, 50%)' }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
