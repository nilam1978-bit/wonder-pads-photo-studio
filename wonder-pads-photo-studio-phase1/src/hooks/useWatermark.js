import { useCallback, useEffect, useState } from 'react';
import { loadImageCanvas } from '../utils/loadImageCanvas';

const SAVED_LOGO_KEY = 'wonder-pads-photo-studio-logo';

export function useWatermark() {
  const [logoFile, setLogoFileState] = useState(null);
  const [logoCanvas, setLogoCanvas] = useState(null);

  useEffect(() => {
    const savedLogo = localStorage.getItem(SAVED_LOGO_KEY);
    if (!savedLogo) return;

    fetch(savedLogo)
      .then((response) => response.blob())
      .then((blob) => {
        setLogoFileState(blob);
        return loadImageCanvas(blob, 800);
      })
      .then(setLogoCanvas)
      .catch(() => localStorage.removeItem(SAVED_LOGO_KEY));
  }, []);

  // Loaded once when you pick a logo, then reused for every photo from
  // then on — no need to re-upload it each time.
  const setLogoFile = useCallback((file) => {
    setLogoFileState(file);
    if (file) {
      loadImageCanvas(file, 800).then(setLogoCanvas);
      const reader = new FileReader();
      reader.onload = () => {
        try {
          localStorage.setItem(SAVED_LOGO_KEY, reader.result);
        } catch {
          // The logo still works for this session if device storage is full.
        }
      };
      reader.readAsDataURL(file);
    } else {
      setLogoCanvas(null);
      localStorage.removeItem(SAVED_LOGO_KEY);
    }
  }, []);

  return { logoFile, logoCanvas, setLogoFile };
}
