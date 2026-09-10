import { useEffect, useMemo, useState } from 'react';
import { useCollection } from '../lib/useCollection';
import { useAddressSuggestions } from '../lib/useAddressSuggestions';
import {
  buildJobWhatsAppMessage,
  calcJobBalance,
  COLLECTED_BY_LABELS,
  defaultCollectedBy,
  mapEmbedUrl,
  mapLink,
  PAYMENT_METHOD_LABELS,
  whatsAppLink,
  type CollectedBy,
  type Category,
  type City,
  type Contractor,
  type Job,
  type PaymentMethod,
} from '../types';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, Select, Textarea, formatCurrency } from '../components/ui';

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
          const { contractorShare, balance } = calcJobBalance(job);
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
                  {contractorById[job.contractorId]?.phone && (
                    <a
                      href={whatsAppLink(
                        contractorById[job.contractorId].phone,
                        buildJobWhatsAppMessage({
                          categoryName: categoryById[job.categoryId]?.name ?? '',
                          cityName: cityById[job.cityId]?.name ?? '',
                          customerName: job.customerName,
                          customerPhone: job.customerPhone,
                          customerAddress: job.customerAddress,
                          amount: job.amount,
                          paymentMethod: job.paymentMethod,
                          notes: job.notes,
                        }),
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-muted"
                      aria-label="שליחה לקבלן בוואטסאפ"
                      title="שליחה לקבלן בוואטסאפ"
                    >
                      📲
                    </a>
                  )}
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

              {job.notes && (
                <p className="rounded-xl bg-surface-muted p-2.5 text-sm text-ink-muted">
                  <span className="font-medium text-ink">הערות: </span>
                  {job.notes}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">סכום עבודה: {formatCurrency(job.amount)}</Badge>
                  <Badge>לקבלן {job.commissionPercent}%: {formatCurrency(contractorShare)}</Badge>
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
  const [cityId, setCityId] = useState(initial?.cityId ?? cities[0]?.id ?? '');
  const availableContractors = contractors.filter(
    (c) => c.categoryId === categoryId && (c.cityIds ?? []).includes(cityId),
  );
  const [contractorId, setContractorId] = useState(initial?.contractorId ?? availableContractors[0]?.id ?? '');
  const [customerName, setCustomerName] = useState(initial?.customerName ?? '');
  const [customerPhone, setCustomerPhone] = useState(initial?.customerPhone ?? '');
  const [customerAddress, setCustomerAddress] = useState(initial?.customerAddress ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [date, setDate] = useState(initial?.date ?? todayStr());
  const [amount, setAmount] = useState(initial?.amount ?? 0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initial?.paymentMethod ?? 'cash');
  const [collectedBy, setCollectedBy] = useState<CollectedBy>(initial?.collectedBy ?? defaultCollectedBy('cash'));
  const [commissionPercent, setCommissionPercent] = useState(
    initial?.commissionPercent ?? availableContractors[0]?.defaultCommissionPercent ?? 20,
  );

  useEffect(() => {
    if (initial) return;
    const first = contractors.find((c) => c.categoryId === categoryId && (c.cityIds ?? []).includes(cityId));
    setContractorId(first?.id ?? '');
    if (first) setCommissionPercent(first.defaultCommissionPercent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, cityId]);

  function handlePaymentMethodChange(method: PaymentMethod) {
    setPaymentMethod(method);
    setCollectedBy(defaultCollectedBy(method));
  }

  const preview = calcJobBalance({ amount: Number(amount) || 0, commissionPercent: Number(commissionPercent) || 0, collectedBy });

  const selectedContractor = contractors.find((c) => c.id === contractorId);
  const selectedCategoryName = categories.find((c) => c.id === categoryId)?.name ?? '';
  const selectedCityName = cities.find((c) => c.id === cityId)?.name ?? '';
  const canSendWhatsApp = !!selectedContractor?.phone && !!customerName.trim();

  const [mapAddress, setMapAddress] = useState(customerAddress);
  useEffect(() => {
    const timer = setTimeout(() => setMapAddress(customerAddress), 600);
    return () => clearTimeout(timer);
  }, [customerAddress]);

  const [addressFocused, setAddressFocused] = useState(false);
  const { suggestions, loading: suggestionsLoading } = useAddressSuggestions(customerAddress, selectedCityName);
  const showSuggestions = addressFocused && customerAddress.trim().length >= 3 && (suggestions.length > 0 || suggestionsLoading);

  function selectAddressSuggestion(label: string) {
    setCustomerAddress(label);
    setMapAddress(label);
    setAddressFocused(false);
  }

  function sendToContractorOnWhatsApp() {
    if (!selectedContractor) return;
    const message = buildJobWhatsAppMessage({
      categoryName: selectedCategoryName,
      cityName: selectedCityName,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      customerAddress: customerAddress.trim(),
      amount: Number(amount) || 0,
      paymentMethod,
      notes,
    });
    window.open(whatsAppLink(selectedContractor.phone, message), '_blank', 'noopener,noreferrer');
  }

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
            notes: notes.trim(),
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
          <Field label="עיר">
            <Select value={cityId} onChange={(e) => setCityId(e.target.value)} required>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="קבלן ביצוע" hint="הרשימה מסוננת אוטומטית לפי התחום והעיר שנבחרו">
          <Select value={contractorId} onChange={(e) => setContractorId(e.target.value)} required>
            {availableContractors.length === 0 && <option value="">אין קבלן בתחום ובעיר האלה</option>}
            {availableContractors.map((c) => (
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

        <Field label="כתובת הלקוח" hint="מתחילים להקליד ובוחרים מהרשימה כדי לוודא שהכתובת קיימת">
          <div className="relative">
            <Input
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              onFocus={() => setAddressFocused(true)}
              onBlur={() => setTimeout(() => setAddressFocused(false), 150)}
              placeholder="רחוב, מספר בית"
              autoComplete="off"
            />
            {showSuggestions && (
              <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-surface shadow-lg">
                {suggestionsLoading && suggestions.length === 0 ? (
                  <p className="px-3.5 py-2.5 text-sm text-ink-muted">מחפש כתובות…</p>
                ) : suggestions.length === 0 ? (
                  <p className="px-3.5 py-2.5 text-sm text-ink-muted">לא נמצאו כתובות תואמות</p>
                ) : (
                  suggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectAddressSuggestion(s.label)}
                      className="block w-full px-3.5 py-2.5 text-right text-sm text-ink hover:bg-surface-muted"
                    >
                      {s.label}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </Field>
        <p className="-mt-2.5 text-xs text-ink-muted">חיפוש הכתובות מבוסס על נתוני OpenStreetMap</p>

        {mapAddress.trim() && (
          <div className="overflow-hidden rounded-xl border border-border">
            <iframe
              title="מפה — אימות כתובת הלקוח"
              src={mapEmbedUrl(mapAddress, selectedCityName)}
              className="h-48 w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
            <a
              href={mapLink(mapAddress, selectedCityName)}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-surface-muted px-3 py-1.5 text-center text-xs text-brand-900 hover:underline"
            >
              פתיחה במפות גוגל בכרטיסייה חדשה
            </a>
          </div>
        )}

        <Field label="הערות" hint="לדוגמה: הוראות הגעה, פרטים לקבלן, מידע נוסף על העבודה">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
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

        <Field label="אחוז שמועבר לקבלן בעבודה זו" hint="האחוז מסכום העבודה שנשאר אצל הקבלן. ברירת המחדל נלקחת מהקבלן, ניתן לשנות לעבודה ספציפית">
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
          <p>
            לקבלן ({commissionPercent}%): <strong>{formatCurrency(preview.contractorShare)}</strong>
          </p>
          <p className="mt-1">עמלה שלך מהעבודה: <strong>{formatCurrency(preview.commissionAmount)}</strong></p>
          <p className="mt-1">
            {preview.balance > 0 && <>הקבלן יצטרך להעביר לך <strong>{formatCurrency(preview.balance)}</strong></>}
            {preview.balance < 0 && <>תצטרך להעביר לקבלן <strong>{formatCurrency(-preview.balance)}</strong></>}
            {preview.balance === 0 && <>מאוזן</>}
          </p>
        </div>

        <Button type="button" variant="secondary" onClick={sendToContractorOnWhatsApp} disabled={!canSendWhatsApp} className="w-full">
          📲 שליחת פרטי העבודה לקבלן בוואטסאפ
        </Button>

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
