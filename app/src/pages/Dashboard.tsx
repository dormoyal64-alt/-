import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useCollection } from '../lib/useCollection';
import { calcJobBalance, type Category, type City, type Contractor, type Job } from '../types';
import { Card, EmptyState, formatCurrency } from '../components/ui';
import { CHART } from '../lib/chartTheme';

export function Dashboard() {
  const categories = useCollection<Category>('categories');
  const contractors = useCollection<Contractor>('contractors');
  const cities = useCollection<City>('cities');
  const jobs = useCollection<Job>('jobs');

  const nameById = (list: { id: string; name: string }[]) => Object.fromEntries(list.map((x) => [x.id, x.name]));
  const categoryName = useMemo(() => nameById(categories.items), [categories.items]);
  const cityName = useMemo(() => nameById(cities.items), [cities.items]);

  const stats = useMemo(() => {
    let revenue = 0;
    let commission = 0;
    let owedToMe = 0;
    let iOwe = 0;
    for (const job of jobs.items) {
      revenue += job.amount;
      const { commissionAmount, balance } = calcJobBalance(job);
      commission += commissionAmount;
      if (job.settled) continue;
      if (balance > 0) owedToMe += balance;
      else iOwe += -balance;
    }
    return { revenue, commission, owedToMe, iOwe, count: jobs.items.length };
  }, [jobs.items]);

  const byCity = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of jobs.items) counts.set(job.cityId, (counts.get(job.cityId) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([cityId, count]) => ({ name: cityName[cityId] ?? 'לא ידוע', count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [jobs.items, cityName]);

  const byCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of jobs.items) counts.set(job.categoryId, (counts.get(job.categoryId) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([categoryId, count]) => ({ name: categoryName[categoryId] ?? 'לא ידוע', count }))
      .sort((a, b) => b.count - a.count);
  }, [jobs.items, categoryName]);

  const byContractor = useMemo(() => {
    const map = new Map<string, { total: number; closed: number }>();
    for (const job of jobs.items) {
      const entry = map.get(job.contractorId) ?? { total: 0, closed: 0 };
      entry.total += 1;
      if (job.settled) entry.closed += 1;
      map.set(job.contractorId, entry);
    }
    return contractors.items
      .map((c) => ({ name: c.name, total: map.get(c.id)?.total ?? 0, closed: map.get(c.id)?.closed ?? 0 }))
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [jobs.items, contractors.items]);

  const hasJobs = jobs.items.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-extrabold text-ink">ראשי</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="סה״כ עבודות" value={String(stats.count)} />
        <StatTile label="מחזור כולל" value={formatCurrency(stats.revenue)} />
        <StatTile label="מגיע לך (פתוח)" value={formatCurrency(stats.owedToMe)} tone="danger" />
        <StatTile label="אתה חייב (פתוח)" value={formatCurrency(stats.iOwe)} tone="success" />
      </div>

      {!hasJobs && !jobs.loading ? (
        <EmptyState title="עדיין אין נתונים להצגה" description="ברגע שתוסיפו עבודות, כאן יופיעו גרפים וסטטיסטיקות." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="עבודות לפי עיר">
            <ResponsiveContainer width="100%" height={Math.max(220, byCity.length * 34)}>
              <BarChart data={byCity} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: CHART.inkMuted, fontSize: 12 }} axisLine={{ stroke: CHART.axis }} tickLine={false} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fill: CHART.inkSecondary, fontSize: 12 }} axisLine={{ stroke: CHART.axis }} tickLine={false} />
                <Tooltip formatter={(v) => [`${v} עבודות`, '']} labelStyle={{ color: CHART.ink }} contentStyle={{ borderRadius: 12, border: `1px solid ${CHART.grid}` }} />
                <Bar dataKey="count" name="עבודות" fill={CHART.series1} radius={[0, 4, 4, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="עבודות לפי תחום">
            <ResponsiveContainer width="100%" height={Math.max(220, byCategory.length * 40)}>
              <BarChart data={byCategory} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: CHART.inkMuted, fontSize: 12 }} axisLine={{ stroke: CHART.axis }} tickLine={false} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fill: CHART.inkSecondary, fontSize: 12 }} axisLine={{ stroke: CHART.axis }} tickLine={false} />
                <Tooltip formatter={(v) => [`${v} עבודות`, '']} labelStyle={{ color: CHART.ink }} contentStyle={{ borderRadius: 12, border: `1px solid ${CHART.grid}` }} />
                <Bar dataKey="count" name="עבודות" fill={CHART.series1} radius={[0, 4, 4, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="עבודות שהתקבלו מול עבודות שנסגרו, לפי קבלן" className="lg:col-span-2">
            <ResponsiveContainer width="100%" height={Math.max(240, byContractor.length * 40)}>
              <BarChart data={byContractor} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: CHART.inkMuted, fontSize: 12 }} axisLine={{ stroke: CHART.axis }} tickLine={false} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fill: CHART.inkSecondary, fontSize: 12 }} axisLine={{ stroke: CHART.axis }} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: `1px solid ${CHART.grid}` }} labelStyle={{ color: CHART.ink }} />
                <Legend wrapperStyle={{ fontSize: 12, color: CHART.inkSecondary }} />
                <Bar dataKey="total" name="סה״כ עבודות שהתקבלו" fill={CHART.series1} radius={[0, 4, 4, 0]} maxBarSize={16} />
                <Bar dataKey="closed" name="עבודות שנסגרו" fill={CHART.series2} radius={[0, 4, 4, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'success' }) {
  const toneClass = tone === 'danger' ? 'text-danger-600' : tone === 'success' ? 'text-success-600' : 'text-ink';
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className={`text-xl font-extrabold ${toneClass}`}>{value}</span>
    </Card>
  );
}

function ChartCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <p className="mb-3 text-sm font-bold text-ink">{title}</p>
      {children}
    </Card>
  );
}
