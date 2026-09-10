import { useEffect, useState } from 'react';
import { useCollection } from '../lib/useCollection';
import { useSeedData } from '../lib/useSeedData';
import type { Category, City, Contractor } from '../types';
import { Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal } from '../components/ui';

type Tab = 'categories' | 'cities';

export function Manage() {
  const [tab, setTab] = useState<Tab>('categories');

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-extrabold text-ink">ניהול</h1>

      <div className="flex gap-2 border-b border-border">
        <TabButton active={tab === 'categories'} onClick={() => setTab('categories')}>
          תחומי עבודה וקבלנים
        </TabButton>
        <TabButton active={tab === 'cities'} onClick={() => setTab('cities')}>
          ערים
        </TabButton>
      </div>

      {tab === 'categories' ? <CategoriesTab /> : <CitiesTab />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
        active ? 'border-brand-900 text-brand-900' : 'border-transparent text-ink-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function CategoriesTab() {
  const categories = useCollection<Category>('categories', { orderByField: 'order' });
  const contractors = useCollection<Contractor>('contractors', { orderByField: 'name' });
  const cities = useCollection<City>('cities', { orderByField: 'name' });
  useSeedData({
    categoriesLoading: categories.loading,
    categories: categories.items,
    addCategory: categories.add,
    citiesLoading: cities.loading,
    cities: cities.items,
    addCity: cities.add,
  });

  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [editCategory, setEditCategory] = useState<Category | null>(null);
  const [deleteCategory, setDeleteCategory] = useState<Category | null>(null);
  const [contractorModal, setContractorModal] = useState<{ categoryId: string; contractor: Contractor | null } | null>(null);
  const [deleteContractor, setDeleteContractor] = useState<Contractor | null>(null);

  async function handleDeleteCategory(cat: Category) {
    const related = contractors.items.filter((c) => c.categoryId === cat.id);
    await Promise.all(related.map((c) => contractors.remove(c.id)));
    await categories.remove(cat.id);
    setDeleteCategory(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setNewCategoryOpen(true)}>+ הוספת תחום עבודה</Button>
      </div>

      {categories.items.length === 0 && !categories.loading ? (
        <EmptyState title="אין עדיין תחומי עבודה" description="הוסיפו תחום עבודה ראשון, למשל אינסטלציה או ניקוי מזגנים." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {categories.items.map((cat) => (
            <Card key={cat.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-base font-bold text-ink">{cat.name}</p>
                <div className="flex gap-1">
                  <button onClick={() => setEditCategory(cat)} className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-muted" aria-label="עריכה">
                    ✏️
                  </button>
                  <button onClick={() => setDeleteCategory(cat)} className="rounded-lg p-1.5 text-danger-600 hover:bg-danger-100" aria-label="מחיקה">
                    🗑️
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {contractors.items
                  .filter((c) => c.categoryId === cat.id)
                  .map((c) => (
                    <div key={c.id} className="flex items-center justify-between rounded-xl bg-surface-muted px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-ink">{c.name}</p>
                        <p className="text-xs text-ink-muted" dir="ltr">
                          {c.phone} · {c.defaultCommissionPercent}% עמלת ברירת מחדל
                        </p>
                        <p className="mt-1 text-xs text-ink-muted">
                          {c.cityIds && c.cityIds.length > 0
                            ? c.cityIds.map((id) => cities.items.find((city) => city.id === id)?.name).filter(Boolean).join(', ')
                            : 'לא הוגדרו ערים'}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setContractorModal({ categoryId: cat.id, contractor: c })}
                          className="rounded-lg p-1.5 text-ink-muted hover:bg-white"
                          aria-label="עריכה"
                        >
                          ✏️
                        </button>
                        <button onClick={() => setDeleteContractor(c)} className="rounded-lg p-1.5 text-danger-600 hover:bg-white" aria-label="מחיקה">
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                {contractors.items.filter((c) => c.categoryId === cat.id).length === 0 && (
                  <p className="text-sm text-ink-muted">אין עדיין קבלנים בתחום זה</p>
                )}
              </div>

              <Button variant="secondary" onClick={() => setContractorModal({ categoryId: cat.id, contractor: null })}>
                + הוספת קבלן
              </Button>
            </Card>
          ))}
        </div>
      )}

      <CategoryModal
        open={newCategoryOpen || !!editCategory}
        initial={editCategory}
        nextOrder={categories.items.length}
        onClose={() => {
          setNewCategoryOpen(false);
          setEditCategory(null);
        }}
        onSave={async (data) => {
          if (editCategory) await categories.update(editCategory.id, data);
          else await categories.add({ ...data, order: categories.items.length, createdAt: Date.now() });
          setNewCategoryOpen(false);
          setEditCategory(null);
        }}
      />

      <ConfirmDialog
        open={!!deleteCategory}
        title="מחיקת תחום עבודה"
        description={`למחוק את "${deleteCategory?.name}"? כל הקבלנים בתחום זה יימחקו גם כן. עבודות קיימות ישמרו בהיסטוריה.`}
        onCancel={() => setDeleteCategory(null)}
        onConfirm={() => deleteCategory && handleDeleteCategory(deleteCategory)}
      />

      {contractorModal && (
        <ContractorModal
          open={!!contractorModal}
          categoryId={contractorModal.categoryId}
          initial={contractorModal.contractor}
          cities={cities.items}
          onClose={() => setContractorModal(null)}
          onSave={async (data) => {
            if (contractorModal.contractor) await contractors.update(contractorModal.contractor.id, data);
            else await contractors.add({ ...data, createdAt: Date.now() });
            setContractorModal(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteContractor}
        title="מחיקת קבלן"
        description={`למחוק את "${deleteContractor?.name}"? עבודות קיימות ישמרו בהיסטוריה.`}
        onCancel={() => setDeleteContractor(null)}
        onConfirm={() => {
          if (deleteContractor) contractors.remove(deleteContractor.id);
          setDeleteContractor(null);
        }}
      />
    </div>
  );
}

function CategoryModal({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: Category | null;
  nextOrder: number;
  onClose: () => void;
  onSave: (data: { name: string }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  useEffect(() => {
    if (open) setName(initial?.name ?? '');
  }, [open, initial]);

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'עריכת תחום עבודה' : 'תחום עבודה חדש'}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onSave({ name: name.trim() });
        }}
      >
        <Field label="שם התחום">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: חשמל" autoFocus required />
        </Field>
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

function ContractorModal({
  open,
  categoryId,
  initial,
  cities,
  onClose,
  onSave,
}: {
  open: boolean;
  categoryId: string;
  initial: Contractor | null;
  cities: City[];
  onClose: () => void;
  onSave: (data: Omit<Contractor, 'id' | 'createdAt'>) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [percent, setPercent] = useState(initial?.defaultCommissionPercent ?? 20);
  const [cityIds, setCityIds] = useState<string[]>(initial?.cityIds ?? []);

  function toggleCity(id: string) {
    setCityIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'עריכת קבלן' : 'קבלן חדש'}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onSave({
            name: name.trim(),
            phone: phone.trim(),
            categoryId,
            cityIds,
            defaultCommissionPercent: Number(percent) || 0,
            active: true,
          });
        }}
      >
        <Field label="שם הקבלן">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </Field>
        <Field label="טלפון">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" placeholder="050-0000000" />
        </Field>
        <Field label="אחוז עמלה לברירת מחדל" hint="ניתן לשנות בכל עבודה בנפרד">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={0.5}
            value={percent}
            onChange={(e) => setPercent(Number(e.target.value))}
          />
        </Field>
        <Field label="ערים בהן הקבלן עובד" hint="עבודות בתחום זה יוצעו לקבלן רק בערים שסימנתם">
          {cities.length === 0 ? (
            <p className="text-sm text-ink-muted">הוסיפו ערים במסך ניהול → ערים</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {cities.map((city) => {
                const checked = cityIds.includes(city.id);
                return (
                  <button
                    type="button"
                    key={city.id}
                    onClick={() => toggleCity(city.id)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      checked ? 'border-brand-900 bg-brand-900 text-white' : 'border-border bg-surface text-ink-muted hover:bg-surface-muted'
                    }`}
                  >
                    {city.name}
                  </button>
                );
              })}
            </div>
          )}
        </Field>
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

function CitiesTab() {
  const cities = useCollection<City>('cities', { orderByField: 'name' });
  const [name, setName] = useState('');
  const [deleteCity, setDeleteCity] = useState<City | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            cities.add({ name: name.trim(), createdAt: Date.now() });
            setName('');
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם עיר חדשה" className="flex-1" />
          <Button type="submit">הוספה</Button>
        </form>
      </Card>

      {cities.items.length === 0 && !cities.loading ? (
        <EmptyState title="אין עדיין ערים" description="הוסיפו עיר ראשונה כדי להתחיל." />
      ) : (
        <div className="flex flex-wrap gap-2">
          {cities.items.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm">
              {c.name}
              <button onClick={() => setDeleteCity(c)} className="text-ink-muted hover:text-danger-600" aria-label="מחיקה">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteCity}
        title="מחיקת עיר"
        description={`למחוק את "${deleteCity?.name}"? עבודות קיימות ישמרו בהיסטוריה.`}
        onCancel={() => setDeleteCity(null)}
        onConfirm={() => {
          if (deleteCity) cities.remove(deleteCity.id);
          setDeleteCity(null);
        }}
      />
    </div>
  );
}
