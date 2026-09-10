import { useEffect, useRef } from 'react';
import { DEFAULT_CATEGORIES, DEFAULT_ISRAELI_CITIES } from './israeliCities';
import type { Category, City } from '../types';

interface Args {
  categoriesLoading: boolean;
  categories: Category[];
  addCategory: (data: Omit<Category, 'id'>) => Promise<void>;
  citiesLoading: boolean;
  cities: City[];
  addCity: (data: Omit<City, 'id'>) => Promise<void>;
}

/** Seeds a starter set of categories & cities once, only when both collections are confirmed empty. */
export function useSeedData({ categoriesLoading, categories, addCategory, citiesLoading, cities, addCity }: Args) {
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current) return;
    if (categoriesLoading || citiesLoading) return;
    if (categories.length > 0 || cities.length > 0) {
      seeded.current = true;
      return;
    }
    seeded.current = true;
    const now = Date.now();
    DEFAULT_CATEGORIES.forEach((name, i) => addCategory({ name, order: i, createdAt: now }));
    DEFAULT_ISRAELI_CITIES.forEach((name) => addCity({ name, createdAt: now }));
  }, [categoriesLoading, categories, addCategory, citiesLoading, cities, addCity]);
}
