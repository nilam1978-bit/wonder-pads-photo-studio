import { useCallback, useState } from 'react';

// Seeded with what you described — feel free to add more from the app
// itself later; these are just a sensible starting point.
const DEFAULT_CATEGORIES = {
  Size: Array.from({ length: 15 }, (_, i) => `${i + 6}in`), // 6in .. 20in
  Type: ['Liner', 'Light', 'Regular', 'Heavy', 'Overnight', 'Postpartum'],
  Material: ['Cotton Topper', 'Bamboo Topper', 'Minky Topper', 'Backed in PUL', 'Backed in Softshell', 'Organic Cotton'],
};

export function useTextPresets() {
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);

  const addChip = useCallback((category, label) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setCategories((prev) => {
      if (prev[category]?.includes(trimmed)) return prev;
      return { ...prev, [category]: [...(prev[category] || []), trimmed] };
    });
  }, []);

  return { categories, addChip };
}
