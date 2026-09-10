import { useEffect, useMemo, useState } from 'react';
import { useCollection } from '../lib/useCollection';
import {
  calcJobBalance,
  COLLECTED_BY_LABELS,
  defaultCollectedBy,
  PAYMENT_METHOD_LABELS,
  type CollectedBy,
  type Category,
  type City,
  type Contractor,
  type Job,
  type PaymentMethod,
} from '../types';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, Select, formatCurrency } from '../components/ui';

export function Jobs() {
  const categories = useCollection<Category>('categories', { orderByField: 'order' });
  const contractors = useCollection<Contractor>('contractors', { orderByField: 'name' });
  const cities = useCollection<City>('cities', { orderByField: 'name' });
  const jobs = useCollection<Job>('jobs', { orderByField: 'date', orderDirection: 'desc' });

  const byId = <T extends { id: string; name: string }>(list: T[]) =>
    Object.fromEntries(list.map((x) => [x.id, x])) as Record<string, T>;
  const categoryById = useMemo(() => byId(categories.items), [categories.items]);
  const contractorById = useMemo(() => byId(contractors.items), [contractors.items]);
  const cityById = useMemo(() => byId(cities.items), [cities.items]);

  const [filterCategory, setFilterCategory] = useState('');
  const [filterContractor, setFilterContractor] = useState('');
  const [filterCity, setFilterCity] = useState('');
  const [filterSettled, setFilterSettled] = useState<'all' | 'open' | 'settled'>('open');

  const [formOpen, setFormOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [deletingJob, setDeletingJob] = useState<Job | null>(null);

  const filteredJobs = jobs.items.filter((j) => {
    if (filterCategory && j.categoryId !== filterCategory) return false;
    if (filterContractor && j.contractorId !== filterContractor) return false;
    if (filterCity && j.cityId !== filterCity) return false;
    if (filterSettled === 'open' && j.settled) return false;
    if (filterSettled === 'settled' && !j.settled) return false;
    return true;
  });

  const hasSetup = categories.items.length > 0 && contractors.items.length > 0 && cities.items.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-ink">עבודות</h1>
        <Button
          onClick={() => {
            setEditingJob(null);
            setFormOpen(true);
          }}
          disabled={!hasSetup}
        >
          + עבודה חדשה
        </Button>
      </div>

      {!hasSetup && !categories.loading && !contractors.loading && !cities.loading && (
        <EmptyState
          title="קודם צריך להגדיר תחומים, קבלנים וערים"
          description="עברו למסך ניהול והוסיפו לפחות תחום עבודה אחד עם קבלן, ועיר אחת."
        />
      )}

      {hasSetup && (
        <Card className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="">כל התחומים</option>
            {categories.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select value={filterContractor} onChange={(e) => setFilterContractor(e.target.value)}>
            <option value="">כל הקבלנים</option>
            {contractors.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select value={filterCity} onChange={(e) => setFilterCity(e.target.value)}>
            <option value="">כל הערים</option>
            {cities.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select value={filterSettled} onChange={(e) => setFilterSettled(e.target.value as typeof filterSettled)}>
            <option value="open">פתוחות בלבד</option>
            <option value="settled">מסולקות בלבד</option>
            <option value="all">הכל</option>
          </Select>
        </Card>
      )}

      {hasSetup && filteredJobs.length === 0 && !jobs.loading && (
        <EmptyState title="לא נמצאו עבודות" description="נסו לשנות את הסינון או להוסיף עבודה חדשה." />
      )}

      <div className="flex flex-col gap-3">
        {filteredJobs.map((job) => {
          const { commissionAmount, balance } = calcJobBalance(job);
          return (
            <Card key={job.id} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-base font-bold text-ink">{job.customerName || 'ללא שם'}</p>
                  <p className="text-xs text-ink-muted">
                    {new Date(job.date).toLocaleDateString('he-IL')} · {cityById[job.cityId]?.name ?? '—'} · {categoryById[job.categoryId]?.name ?? '—'}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      setEditingJob(job);
                      setFormOpen(true);
                    }}
                    className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-muted"
                    aria-label="עריכה"
                  >
                    ✏️
                  </button>
                  <button onClick={() => setDeletingJob(job)} className="rounded-lg p-1.5 text-danger-600 hover:bg-danger-100" aria-label="מחיקה">
                    🗑️
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-ink-muted sm:grid-cols-4">
                <InfoItem label="קבלן" value={contractorById[job.contractorId]?.name ?? '—'} />
                <InfoItem label="טלפון לקוח" value={job.customerPhone || '—'} dir="ltr" />
                <InfoItem label="כתובת" value={job.customerAddress || '—'} />
                <InfoItem label="תשלום" value={`${PAYMENT_METHOD_LABELS[job.paymentMethod]} · גבה ${COLLECTED_BY_LABELS[job.collectedBy]}`} />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">סכום עבודה: {formatCurrency(job.amount)}</Badge>
                  <Badge>עמלה {job.commissionPercent}%: {formatCurrency(commissionAmount)}</Badge>
                  {balance > 0 ? (
                    <Badge tone="danger">הקבלן חייב לך {formatCurrency(balance)}</Badge>
                  ) : balance < 0 ? (
                    <Badge tone="success">אתה חייב לקבלן {formatCurrency(-balance)}</Badge>
                  ) : (
                    <Badge tone="success">מאוזן</Badge>
                  )}
                </div>
                <label className="flex items-center gap-2 text-sm text-ink-muted">
                  <input
                    type="checkbox"
                    checked={job.settled}
                    onChange={(e) => jobs.update(job.id, { settled: e.target.checked, updatedAt: Date.now() })}
                  />
                  סולק
                </label>
              </div>
            </Card>
          );
        })}
      </div>

      {formOpen && (
        <JobFormModal
          open={formOpen}
          initial={editingJob}
          categories={categories.items}
          contractors={contractors.items}
          cities={cities.items}
          onClose={() => setFormOpen(false)}
          onSave={async (data) => {
            if (editingJob) await jobs.update(editingJob.id, { ...data, updatedAt: Date.now() });
            else await jobs.add({ ...data, settled: false, createdAt: Date.now(), updatedAt: Date.now() });
            setFormOpen(false);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deletingJob}
        title="מחיקת עבודה"
        description={`למחוק את העבודה של "${deletingJob?.customerName}"?`}
        onCancel={() => setDeletingJob(null)}
        onConfirm={() => {
          if (deletingJob) jobs.remove(deletingJob.id);
          setDeletingJob(null);
        }}
      />
    </div>
  );
}

function InfoItem({ label, value, dir }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div>
      <span className="block text-xs text-ink-muted/70">{label}</span>
      <span dir={dir} className="text-ink">
        {value}
      </span>
    </div>
  );
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function JobFormModal({
  open,
  initial,
  categories,
  contractors,
  cities,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: Job | null;
  categories: Category[];
  contractors: Contractor[];
  cities: City[];
  onClose: () => void;
  onSave: (data: Omit<Job, 'id' | 'createdAt' | 'updatedAt' | 'settled'>) => void;
}) {
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories[0]?.id ?? '');
  const contractorsInCategory = contractors.filter((c) => c.categoryId === categoryId);
  const [contractorId, setContractorId] = useState(initial?.contractorId ?? contractorsInCategory[0]?.id ?? '');
  const [cityId, setCityId] = useState(initial?.cityId ?? cities[0]?.id ?? '');
  const [customerName, setCustomerName] = useState(initial?.customerName ?? '');
  const [customerPhone, setCustomerPhone] = useState(initial?.customerPhone ?? '');
  const [customerAddress, setCustomerAddress] = useState(initial?.customerAddress ?? '');
  const [date, setDate] = useState(initial?.date ?? todayStr());
  const [amount, setAmount] = useState(initial?.amount ?? 0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initial?.paymentMethod ?? 'cash');
  const [collectedBy, setCollectedBy] = useState<CollectedBy>(initial?.collectedBy ?? defaultCollectedBy('cash'));
  const [commissionPercent, setCommissionPercent] = useState(
    initial?.commissionPercent ?? contractorsInCategory[0]?.defaultCommissionPercent ?? 20,
  );

  useEffect(() => {
    if (initial) return;
    const first = contractors.find((c) => c.categoryId === categoryId);
    setContractorId(first?.id ?? '');
    if (first) setCommissionPercent(first.defaultCommissionPercent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  function handlePaymentMethodChange(method: PaymentMethod) {
    setPaymentMethod(method);
    setCollectedBy(defaultCollectedBy(method));
  }

  const preview = calcJobBalance({ amount: Number(amount) || 0, commissionPercent: Number(commissionPercent) || 0, collectedBy });

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'עריכת עבודה' : 'עבודה חדשה'}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!categoryId || !contractorId || !cityId) return;
          onSave({
            categoryId,
            contractorId,
            cityId,
            customerName: customerName.trim(),
            customerPhone: customerPhone.trim(),
            customerAddress: customerAddress.trim(),
            date,
            amount: Number(amount) || 0,
            paymentMethod,
            collectedBy,
            commissionPercent: Number(commissionPercent) || 0,
          });
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="תחום עבודה">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="קבלן ביצוע">
            <Select value={contractorId} onChange={(e) => setContractorId(e.target.value)} required>
              {contractorsInCategory.length === 0 && <option value="">אין קבלנים בתחום זה</option>}
              {contractorsInCategory.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="עיר">
          <Select value={cityId} onChange={(e) => setCityId(e.target.value)} required>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="שם הלקוח">
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
          </Field>
          <Field label="טלפון הלקוח">
            <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} dir="ltr" placeholder="050-0000000" />
          </Field>
        </div>

        <Field label="כתובת הלקוח">
          <Input value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="תאריך">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="סכום העבודה (₪)">
            <Input type="number" inputMode="decimal" min={0} step={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} required />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="אופן תשלום">
            <Select value={paymentMethod} onChange={(e) => handlePaymentMethodChange(e.target.value as PaymentMethod)}>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="מי גבה את התשלום בפועל">
            <Select value={collectedBy} onChange={(e) => setCollectedBy(e.target.value as CollectedBy)}>
              {Object.entries(COLLECTED_BY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="אחוז עמלה לעבודה זו" hint="ברירת המחדל נלקחת מהקבלן, ניתן לשנות לעבודה ספציפית">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={0.5}
            value={commissionPercent}
            onChange={(e) => setCommissionPercent(Number(e.target.value))}
          />
        </Field>

        <div className="rounded-xl bg-surface-muted p-3 text-sm">
          <p>עמלה שלך מהעבודה: <strong>{formatCurrency(preview.commissionAmount)}</strong></p>
          <p className="mt-1">
            {preview.balance > 0 && <>הקבלן יצטרך להעביר לך <strong>{formatCurrency(preview.balance)}</strong></>}
            {preview.balance < 0 && <>תצטרך להעביר לקבלן <strong>{formatCurrency(-preview.balance)}</strong></>}
            {preview.balance === 0 && <>מאוזן</>}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit">שמירה</Button>
        </div>
      </form>
    </Modal>
  );
}
