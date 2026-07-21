import { useCallback, useState } from 'react';
import { createThumbnail } from '../utils/thumbnail';

// Every photo in the library looks like this. "editState" starts empty and
// is where Phase 2+ will store crop rectangles, background choices, filter
// values, and preset names. Nothing here ever touches the original file —
// edits are always just numbers describing what to do, applied at render
// or export time. This is what makes undo, re-editing, and batch-apply
// possible later without any extra work.
//
// {
//   id: string,
//   file: File,              // the untouched original, kept in memory
//   fileName: string,
//   thumbUrl: string,        // small preview shown in the grid
//   fullWidth: number,
//   fullHeight: number,
//   selected: boolean,
//   status: 'untouched' | 'edited' | 'preset',
//   editState: {
//     crop: null,            // Phase 2
//     background: null,      // Phase 2 (pad-fill) / Phase 4 (bg swap)
//     adjustments: {},       // Phase 3
//     presetName: null,      // Phase 3
//   },
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
            fullWidth,
            fullHeight,
            selected: false,
            status: 'untouched',
            editState: {
              crop: null,
              background: null,
              adjustments: {},
              presetName: null,
            },
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
      if (target) URL.revokeObjectURL(target.thumbUrl);
      return prev.filter((img) => img.id !== id);
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
  // thumbnail, and marks the photo as edited — all in one update. The old
  // thumbnail URL is released so memory doesn't creep up over a long
  // editing session.
  const saveEdit = useCallback((id, editState, newThumbUrl) => {
    setImages((prev) =>
      prev.map((img) => {
        if (img.id !== id) return img;
        URL.revokeObjectURL(img.thumbUrl);
        return { ...img, editState, thumbUrl: newThumbUrl, status: 'edited' };
      })
    );
  }, []);

  return {
    images,
    isImporting,
    addFiles,
    removeImage,
    toggleSelect,
    selectAll,
    clearSelection,
    selectedCount,
    saveEdit,
  };
}
