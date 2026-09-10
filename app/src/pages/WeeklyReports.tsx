import { useMemo, useState } from 'react';
import { useCollection } from '../lib/useCollection';
import { weekOf } from '../lib/weeks';
import { calcJobBalance, type Contractor, type Job } from '../types';
import { Badge, Card, EmptyState, Select, formatCurrency } from '../components/ui';

interface WeekGroup {
  key: string;
  label: string;
  jobs: Job[];
  totalAmount: number;
  totalCommission: number;
  balance: number; // positive: contractor owes owner
}

export function WeeklyReports() {
  const contractors = useCollection<Contractor>('contractors', { orderByField: 'name' });
  const jobs = useCollection<Job>('jobs', { orderByField: 'date', orderDirection: 'desc' });

  const [contractorId, setContractorId] = useState('');

  const jobsForContractor = useMemo(
    () => jobs.items.filter((j) => !contractorId || j.contractorId === contractorId),
    [jobs.items, contractorId],
  );

  const weeks = useMemo(() => {
    const map = new Map<string, WeekGroup>();
    for (const job of jobsForContractor) {
      const { key, label } = weekOf(job.date);
      const group = map.get(key) ?? { key, label, jobs: [], totalAmount: 0, totalCommission: 0, balance: 0 };
      const { commissionAmount, balance } = calcJobBalance(job);
      group.jobs.push(job);
      group.totalAmount += job.amount;
      group.totalCommission += commissionAmount;
      group.balance += balance;
      map.set(key, group);
    }
    return Array.from(map.values()).sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [jobsForContractor]);

  const hasContractors = contractors.items.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-extrabold text-ink">דוחות שבועיים</h1>

      {hasContractors && (
        <Card>
          <Select value={contractorId} onChange={(e) => setContractorId(e.target.value)}>
            <option value="">כל הקבלנים (מאוחד)</option>
            {contractors.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Card>
      )}

      {weeks.length === 0 && !jobs.loading ? (
        <EmptyState title="אין עדיין נתונים" description="ברגע שתתחילו להזין עבודות, כאן יופיע סיכום שבועי." />
      ) : (
        <div className="flex flex-col gap-4">
          {weeks.map((week) => (
            <Card key={week.key}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                <p className="text-base font-bold text-ink">שבוע {week.label}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge>{week.jobs.length} עבודות</Badge>
                  <Badge tone="accent">מחזור: {formatCurrency(week.totalAmount)}</Badge>
                  <Badge tone="accent">עמלה כוללת: {formatCurrency(week.totalCommission)}</Badge>
                  {week.balance > 0 ? (
                    <Badge tone="danger">מגיע לך {formatCurrency(week.balance)}</Badge>
                  ) : week.balance < 0 ? (
                    <Badge tone="success">אתה חייב {formatCurrency(-week.balance)}</Badge>
                  ) : (
                    <Badge tone="success">מאוזן</Badge>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-right text-xs text-ink-muted">
                      <th className="py-1.5 font-medium">תאריך</th>
                      {!contractorId && <th className="py-1.5 font-medium">קבלן</th>}
                      <th className="py-1.5 font-medium">לקוח</th>
                      <th className="py-1.5 font-medium">סכום</th>
                      <th className="py-1.5 font-medium">עמלה</th>
                      <th className="py-1.5 font-medium">יתרה</th>
                      <th className="py-1.5 font-medium">סטטוס</th>
                    </tr>
                  </thead>
                  <tbody>
                    {week.jobs.map((job) => {
                      const { commissionAmount, balance } = calcJobBalance(job);
                      const contractorName = contractors.items.find((c) => c.id === job.contractorId)?.name ?? '—';
                      return (
                        <tr key={job.id} className="border-t border-border">
                          <td className="py-2">{new Date(job.date).toLocaleDateString('he-IL')}</td>
                          {!contractorId && <td className="py-2">{contractorName}</td>}
                          <td className="py-2">{job.customerName}</td>
                          <td className="py-2">{formatCurrency(job.amount)}</td>
                          <td className="py-2">{formatCurrency(commissionAmount)}</td>
                          <td className="py-2">
                            {balance > 0 ? `+${formatCurrency(balance)}` : balance < 0 ? `-${formatCurrency(-balance)}` : '—'}
                          </td>
                          <td className="py-2">
                            {job.settled ? <Badge tone="success">סולק</Badge> : <Badge tone="danger">פתוח</Badge>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
