import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar, Legend } from 'recharts';

interface MSERadarProps {
  motion: number;
  sound: number;
  eyes: number;
  refMotion?: number;
  refSound?: number;
  refEyes?: number;
  showReference?: boolean;
}

const MSE_COLORS = {
  motion: 'hsl(160, 59%, 42%)',
  sound: 'hsl(0, 84%, 60%)',
  eyes: 'hsl(217, 91%, 60%)',
};

export default function MSERadarChart({ motion, sound, eyes, refMotion, refSound, refEyes, showReference }: MSERadarProps) {
  const data = [
    { axis: 'Motion', value: motion, ref: refMotion ?? 0 },
    { axis: 'Sound', value: sound, ref: refSound ?? 0 },
    { axis: 'Eyes', value: eyes, ref: refEyes ?? 0 },
  ];

  return (
    <ResponsiveContainer width="100%" height={220}>
      <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
        <PolarGrid stroke="hsl(220, 14%, 22%)" />
        <PolarAngleAxis dataKey="axis" tick={{ fill: 'hsl(215, 14%, 50%)', fontSize: 12 }} />
        {showReference && (
          <Radar name="Reference" dataKey="ref" stroke="hsl(38, 92%, 50%)" fill="hsl(38, 92%, 50%)" fillOpacity={0.1} strokeDasharray="4 4" />
        )}
        <Radar name="You" dataKey="value" stroke="hsl(173, 58%, 52%)" fill="hsl(173, 58%, 52%)" fillOpacity={0.25} strokeWidth={2} />
        {showReference && <Legend wrapperStyle={{ fontSize: 11 }} />}
      </RadarChart>
    </ResponsiveContainer>
  );
}
