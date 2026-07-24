import { useCallback, useState } from 'react';
import { loadImageCanvas } from '../utils/loadImageCanvas';

export function useWatermark() {
  const [logoFile, setLogoFileState] = useState(null);
  const [logoCanvas, setLogoCanvas] = useState(null);

  // Loaded once when you pick a logo, then reused for every photo from
  // then on — no need to re-upload it each time.
  const setLogoFile = useCallback((file) => {
    setLogoFileState(file);
    if (file) {
      loadImageCanvas(file, 800).then(setLogoCanvas);
    } else {
      setLogoCanvas(null);
    }
  }, []);

  return { logoFile, logoCanvas, setLogoFile };
}
