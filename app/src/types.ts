export type PaymentMethod = 'cash' | 'credit' | 'transfer' | 'check';

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
};

export const COLLECTED_BY_LABELS: Record<CollectedBy, string> = {
  contractor: 'הקבלן',
  owner: 'אני (בעל העסק)',
};

export function defaultCollectedBy(method: PaymentMethod): CollectedBy {
  return method === 'transfer' || method === 'check' ? 'owner' : 'contractor';
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
