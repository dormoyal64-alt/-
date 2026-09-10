export type PaymentMethod = 'cash' | 'credit' | 'transfer' | 'check' | 'bit' | 'paybox';

export type CollectedBy = 'contractor' | 'owner';

export interface Category {
  id: string;
  name: string;
  order: number;
  createdAt: number;
}

export interface Contractor {
  id: string;
  name: string;
  phone: string;
  categoryId: string;
  /** Cities this contractor serves; used to auto-filter contractors by category+city on the job form. */
  cityIds: string[];
  defaultCommissionPercent: number;
  active: boolean;
  notes?: string;
  createdAt: number;
}

export interface City {
  id: string;
  name: string;
  createdAt: number;
}

export interface Job {
  id: string;
  categoryId: string;
  contractorId: string;
  cityId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  date: string; // yyyy-MM-dd
  amount: number;
  paymentMethod: PaymentMethod;
  collectedBy: CollectedBy;
  commissionPercent: number;
  settled: boolean;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'מזומן',
  credit: 'אשראי',
  transfer: 'העברה בנקאית',
  check: "צ'ק",
  bit: 'ביט',
  paybox: 'פייבוקס',
};

export const COLLECTED_BY_LABELS: Record<CollectedBy, string> = {
  contractor: 'הקבלן',
  owner: 'אני (בעל העסק)',
};

export function defaultCollectedBy(method: PaymentMethod): CollectedBy {
  return method === 'cash' || method === 'credit' ? 'contractor' : 'owner';
}

/** Normalizes an Israeli local number (e.g. "050-1234567") to E.164 digits for a wa.me link. */
export function toWhatsAppDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return '972' + digits.slice(1);
  return digits;
}

export function buildJobWhatsAppMessage(args: {
  categoryName: string;
  cityName: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  amount: number;
  paymentMethod: PaymentMethod;
  notes?: string;
}): string {
  const lines = [
    'עבודה חדשה 🛠️',
    `תחום: ${args.categoryName}`,
    `עיר: ${args.cityName}`,
    `לקוח: ${args.customerName}`,
    `טלפון לקוח: ${args.customerPhone}`,
    `כתובת: ${args.customerAddress}`,
    `מחיר התחלתי שסוכם: ${args.amount} ₪`,
    `אופן תשלום: ${PAYMENT_METHOD_LABELS[args.paymentMethod]}`,
  ];
  if (args.notes && args.notes.trim()) lines.push(`הערות: ${args.notes.trim()}`);
  return lines.join('\n');
}

export function whatsAppLink(phone: string, message: string): string {
  return `https://wa.me/${toWhatsAppDigits(phone)}?text=${encodeURIComponent(message)}`;
}

/** Address query used for both the live map preview and the "open in Google Maps" link. */
export function addressQuery(address: string, cityName: string): string {
  return [address.trim(), cityName.trim()].filter(Boolean).join(', ');
}

export function mapEmbedUrl(address: string, cityName: string): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(addressQuery(address, cityName))}&output=embed`;
}

export function mapLink(address: string, cityName: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressQuery(address, cityName))}`;
}

export interface JobBalance {
  commissionAmount: number;
  contractorShare: number;
  /** positive: contractor owes owner. negative: owner owes contractor. */
  balance: number;
}

export function calcJobBalance(job: Pick<Job, 'amount' | 'commissionPercent' | 'collectedBy'>): JobBalance {
  const commissionAmount = round2((job.amount * job.commissionPercent) / 100);
  const contractorShare = round2(job.amount - commissionAmount);
  const balance = job.collectedBy === 'contractor' ? commissionAmount : -contractorShare;
  return { commissionAmount, contractorShare, balance: round2(balance) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
