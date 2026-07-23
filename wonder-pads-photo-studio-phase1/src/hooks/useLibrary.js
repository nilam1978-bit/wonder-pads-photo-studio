import { useCallback, useState } from 'react';
import { createThumbnail } from '../utils/thumbnail';

// Every photo in the library looks like this. "editState" starts empty and
// is where the Editor stores crop rectangles, background choices, filter
// values, and preset names. Nothing here ever touches the original file —
// edits are always just numbers describing what to do, applied at render
// or export time. This is what makes undo, re-editing, and batch-apply
// possible without any extra work.
//
// {
//   id: string,
//   file: File,                 // the untouched original, kept in memory
//   fileName: string,
//   thumbUrl: string,           // current preview shown in the grid
//   originalThumbUrl: string,   // untouched preview, kept so Reset works
//   bgRemovedCanvas: canvas|null, // cached AI cutout, computed once
//   fullWidth: number,
//   fullHeight: number,
//   selected: boolean,
//   status: 'untouched' | 'edited' | 'preset',
//   editState: { mode, ratioKey, crop, fitFill, adjustments, removeBackground } | null,
// }

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useLibrary() {
  const [images, setImages] = useState([]);
  const [isImporting, setIsImporting] = useState(false);

  const addFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;

    setIsImporting(true);

    // Process one at a time rather than all at once — with a big batch from
    // a phone camera roll this keeps the tab responsive instead of freezing
    // while every thumbnail generates simultaneously.
    for (const file of files) {
      try {
        const { thumbUrl, fullWidth, fullHeight } = await createThumbnail(file);
        setImages((prev) => [
          ...prev,
          {
            id: makeId(),
            file,
            fileName: file.name,
            thumbUrl,
            originalThumbUrl: thumbUrl,
            bgRemovedCanvas: null,
            fullWidth,
            fullHeight,
            selected: false,
            status: 'untouched',
            editState: null,
          },
        ]);
      } catch (err) {
        console.error(`Could not read "${file.name}" — skipping.`, err);
      }
    }

    setIsImporting(false);
  }, []);

  const removeImage = useCallback((id) => {
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) {
        URL.revokeObjectURL(target.originalThumbUrl);
        if (target.thumbUrl !== target.originalThumbUrl) URL.revokeObjectURL(target.thumbUrl);
      }
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  // Removes every photo from the library at once, for starting a fresh
  // batch. Releases every thumbnail URL first so nothing leaks.
  const clearAll = useCallback(() => {
    setImages((prev) => {
      prev.forEach((img) => {
        URL.revokeObjectURL(img.originalThumbUrl);
        if (img.thumbUrl !== img.originalThumbUrl) URL.revokeObjectURL(img.thumbUrl);
      });
      return [];
    });
  }, []);

  const toggleSelect = useCallback((id) => {
    setImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, selected: !img.selected } : img))
    );
  }, []);

  const selectAll = useCallback(() => {
    setImages((prev) => prev.map((img) => ({ ...img, selected: true })));
  }, []);

  const clearSelection = useCallback(() => {
    setImages((prev) => prev.map((img) => ({ ...img, selected: false })));
  }, []);

  const selectedCount = images.filter((img) => img.selected).length;

  // Used when saving an edit: swaps in a new edit state, a new preview
  // thumbnail, and marks the photo as edited — all in one update. Never
  // revokes the pristine original thumbnail, only ever a previously
  // generated edited one, so Reset always has something real to go back to.
  const saveEdit = useCallback((id, editState, newThumbUrl, status = 'edited') => {
    setImages((prev) =>
      prev.map((img) => {
        if (img.id !== id) return img;
        if (img.thumbUrl !== img.originalThumbUrl) URL.revokeObjectURL(img.thumbUrl);
        return { ...img, editState, thumbUrl: newThumbUrl, status };
      })
    );
  }, []);

  // Caches the AI background-removal result on the photo itself, so
  // re-opening the Editor later (in this same session) doesn't need to
  // re-run the model.
  const setBgRemovedCanvas = useCallback((id, canvas) => {
    setImages((prev) => prev.map((img) => (img.id === id ? { ...img, bgRemovedCanvas: canvas } : img)));
  }, []);

  // Reverts one photo back to exactly how it was on upload — clears the
  // edit state and restores the original thumbnail. The cached background
  // cutout (if any) is kept, since re-running the AI model again would be
  // wasteful and the cutout itself isn't a "change" you'd want to redo.
  const resetImage = useCallback((id) => {
    setImages((prev) =>
      prev.map((img) => {
        if (img.id !== id) return img;
        if (img.thumbUrl !== img.originalThumbUrl) URL.revokeObjectURL(img.thumbUrl);
        return { ...img, editState: null, thumbUrl: img.originalThumbUrl, status: 'untouched' };
      })
    );
  }, []);

  return {
    images,
    isImporting,
    addFiles,
    removeImage,
    clearAll,
    toggleSelect,
    selectAll,
    clearSelection,
    selectedCount,
    saveEdit,
    setBgRemovedCanvas,
    resetImage,
  };
}
