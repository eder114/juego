import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { dateShort, money } from '../lib/format';

export const CHART_COLORS = ['#22c55e', '#38bdf8', '#f5c542', '#f472b6', '#a78bfa', '#fb923c'];

export const tooltipStyle = {
  contentStyle: { background: '#0e1623', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 12, color: '#e2e8f0' },
  labelStyle: { color: '#94a3b8', marginBottom: 4 },
  itemStyle: { color: '#e2e8f0' },
  cursor: { fill: 'rgba(255,255,255,0.04)' },
};
const axis = { stroke: '#475569', fontSize: 11, tickLine: false, axisLine: false } as const;

export function PointsHistoryChart({ data, height = 220 }: { data: { gameweek: number; points: number; average?: number; highest?: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="barGreen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4ade80" />
            <stop offset="100%" stopColor="#15803d" />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="gameweek" tickFormatter={(v) => `J${v}`} {...axis} />
        <YAxis {...axis} allowDecimals={false} />
        <Tooltip {...tooltipStyle} labelFormatter={(v) => `Jornada ${v}`} />
        <Bar dataKey="points" name="Tus puntos" fill="url(#barGreen)" radius={[6, 6, 0, 0]} maxBarSize={36} />
        {data.some((d) => d.average !== undefined) && <Line dataKey="average" name="Media" stroke="#38bdf8" strokeWidth={2} dot={false} type="monotone" />}
        {data.some((d) => d.highest !== undefined) && <Line dataKey="highest" name="Máximo" stroke="#f5c542" strokeWidth={1.5} strokeDasharray="4 4" dot={false} type="monotone" />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function PriceChart({ data, height = 200 }: { data: { price: number; createdAt: string }[]; height?: number }) {
  const points = data.map((d) => ({ ...d, value: d.price / 10 }));
  if (points.length === 1) points.push({ ...points[0], createdAt: new Date().toISOString() });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="createdAt" tickFormatter={(v) => dateShort(v).replace(/ \d{4}$/, '')} {...axis} minTickGap={24} />
        <YAxis {...axis} domain={['dataMin - 0.2', 'dataMax + 0.2']} tickFormatter={(v) => `£${Number(v).toFixed(1)}`} width={52} />
        <Tooltip {...tooltipStyle} labelFormatter={(v) => dateShort(v as string)} formatter={(_v, _n, item) => [money((item.payload as { price: number }).price), 'Precio']} />
        <Area type="stepAfter" dataKey="value" stroke="#22c55e" strokeWidth={2} fill="url(#priceFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
