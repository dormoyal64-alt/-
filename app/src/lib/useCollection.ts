import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  type OrderByDirection,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface Options {
  orderByField?: string;
  orderDirection?: OrderByDirection;
}

export function useCollection<T extends { id: string }>(name: string, options: Options = {}) {
  const { user } = useAuth();
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const path = useMemo(() => (user ? `users/${user.uid}/${name}` : null), [user, name]);

  useEffect(() => {
    if (!db || !path) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const col = collection(db, path);
    const q = options.orderByField
      ? query(col, orderBy(options.orderByField, options.orderDirection ?? 'asc'))
      : col;
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setItems(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as T));
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, options.orderByField, options.orderDirection]);

  async function add(data: Omit<T, 'id'>) {
    if (!db || !path) throw new Error('אין חיבור למסד הנתונים');
    await addDoc(collection(db, path), data);
  }

  async function update(id: string, data: Partial<Omit<T, 'id'>>) {
    if (!db || !path) throw new Error('אין חיבור למסד הנתונים');
    await updateDoc(doc(db, path, id), data);
  }

  async function remove(id: string) {
    if (!db || !path) throw new Error('אין חיבור למסד הנתונים');
    await deleteDoc(doc(db, path, id));
  }

  return { items, loading, error, add, update, remove };
}
