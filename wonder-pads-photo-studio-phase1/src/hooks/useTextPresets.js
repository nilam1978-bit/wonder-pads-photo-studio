import { useCallback, useEffect, useState } from 'react';

// Seeded with what you described — feel free to add more from the app
// itself later; these are just a sensible starting point.
const DEFAULT_CATEGORIES = {
  Size: Array.from({ length: 15 }, (_, i) => `${i + 6}in`), // 6in .. 20in
  Type: ['Liner', 'Light', 'Regular', 'Heavy', 'Overnight', 'Postpartum'],
  Material: ['Cotton Topper', 'Bamboo Topper', 'Minky Topper', 'Backed in PUL', 'Backed in Softshell', 'Organic Cotton'],
};

const STORAGE_KEY = 'wonder-pads-text-library-v1';

function loadSavedLibrary() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return {
      categories: saved?.categories || DEFAULT_CATEGORIES,
      textBlocks: Array.isArray(saved?.textBlocks) ? saved.textBlocks : [],
    };
  } catch {
    return { categories: DEFAULT_CATEGORIES, textBlocks: [] };
  }
}

export function useTextPresets() {
  const [library, setLibrary] = useState(loadSavedLibrary);
  const { categories, textBlocks } = library;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  }, [library]);

  const addChip = useCallback((category, label) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setLibrary((prev) => {
      if (prev.categories[category]?.includes(trimmed)) return prev;
      return {
        ...prev,
        categories: {
          ...prev.categories,
          [category]: [...(prev.categories[category] || []), trimmed],
        },
      };
    });
  }, []);

  const addTextBlock = useCallback((name, text) => {
    const cleanName = name.trim();
    const cleanText = text.trim();
    if (!cleanName || !cleanText) return false;
    setLibrary((prev) => ({
      ...prev,
      textBlocks: [
        ...prev.textBlocks,
        {
          id: `text-block-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: cleanName,
          text: cleanText,
        },
      ],
    }));
    return true;
  }, []);

  const removeTextBlock = useCallback((id) => {
    setLibrary((prev) => ({
      ...prev,
      textBlocks: prev.textBlocks.filter((block) => block.id !== id),
    }));
  }, []);

  return { categories, addChip, textBlocks, addTextBlock, removeTextBlock };
}
