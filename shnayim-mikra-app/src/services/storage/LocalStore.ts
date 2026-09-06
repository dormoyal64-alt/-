import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Thin typed wrapper around AsyncStorage. All app data at rest — settings,
 * progress/streak, cached weekly texts — goes through this single module,
 * so swapping the backing store (e.g. to SQLite or a future cloud sync)
 * later only means reimplementing this file.
 */
const NAMESPACE = 'shnayimMikra';

function nsKey(key: string): string {
  return `${NAMESPACE}:${key}`;
}

export async function getItem<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(nsKey(key));
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setItem<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(nsKey(key), JSON.stringify(value));
}

export async function removeItem(key: string): Promise<void> {
  await AsyncStorage.removeItem(nsKey(key));
}

export async function getAllKeysWithPrefix(prefix: string): Promise<string[]> {
  const all = await AsyncStorage.getAllKeys();
  const full = nsKey(prefix);
  return all.filter((k) => k.startsWith(full)).map((k) => k.slice(NAMESPACE.length + 1));
}

export async function multiRemove(keys: string[]): Promise<void> {
  await AsyncStorage.removeMany(keys.map(nsKey));
}
