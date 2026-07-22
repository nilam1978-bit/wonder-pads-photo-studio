import { useCallback, useState } from 'react';

function makeId() {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function usePresets() {
  const [presets, setPresets] = useState([]);

  // A preset stores the "look" only — mode, ratio, pad-fill choice, and
  // adjustments. It deliberately does NOT store the literal crop
  // rectangle, since that's specific to one photo's shape; applying a
  // preset recomputes a fresh centered crop for whichever photo it's
  // used on.
  const addPreset = useCallback((name, look) => {
    setPresets((prev) => [...prev, { id: makeId(), name, look }]);
  }, []);

  const removePreset = useCallback((id) => {
    setPresets((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { presets, addPreset, removePreset };
}
