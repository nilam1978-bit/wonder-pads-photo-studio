import { useCallback, useRef, useState } from 'react';
import { useLibrary } from './hooks/useLibrary';
import { usePresets } from './hooks/usePresets';
import { RATIOS, computeCenteredCrop } from './utils/renderEdit';
import { renderFullEdit, makeThumbFromCanvas } from './utils/exportImage';
import Editor from './components/Editor';
import './App.css';

const STATUS_LABELS = {
  untouched: 'Untouched',
  edited: 'Edited',
  preset: 'Preset applied',
};

function App() {
  const {
    images,
    isImporting,
    addFiles,
    removeImage,
    toggleSelect,
    selectAll,
    clearSelection,
    selectedCount,
    saveEdit,
  } = useLibrary();
  const { presets, addPreset } = usePresets();

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [showPresetPicker, setShowPresetPicker] = useState(false);
  const [applyingPreset, setApplyingPreset] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileInput = useCallback(
    (e) => {
      addFiles(e.target.files);
      e.target.value = ''; // lets you re-pick the same file again later
    },
    [addFiles]
  );

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setIsDraggingOver(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  // Applies a saved preset's look to every currently-selected photo, one
  // at a time. Updates each photo's thumbnail and status in the library —
  // it doesn't trigger a download for each one (that's what the Editor's
  // single-photo Save button is for); a proper "download the whole batch"
  // step is planned for a later phase.
  const handleApplyPreset = async (preset) => {
    setApplyingPreset(true);
    const targets = images.filter((img) => img.selected);
    for (const img of targets) {
      let editState = {
        mode: preset.look.mode,
        ratioKey: preset.look.ratioKey,
        fitFill: preset.look.fitFill,
        adjustments: preset.look.adjustments,
      };
      if (preset.look.mode === 'crop') {
        editState.crop = computeCenteredCrop(img.fullWidth, img.fullHeight, RATIOS[preset.look.ratioKey]);
      }
      const outCanvas = await renderFullEdit(img.file, editState);
      const newThumbUrl = await makeThumbFromCanvas(outCanvas);
      saveEdit(img.id, editState, newThumbUrl, 'preset');
    }
    setApplyingPreset(false);
    setShowPresetPicker(false);
  };

  const editingImage = images.find((img) => img.id === editingId);

  if (editingImage) {
    return (
      <Editor
        image={editingImage}
        presets={presets}
        onAddPreset={addPreset}
        onClose={() => setEditingId(null)}
        onSave={(id, editState, newThumbUrl, status) => {
          saveEdit(id, editState, newThumbUrl, status);
          setEditingId(null);
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Wonder Pads Photo Studio</h1>
        <p className="app-subtitle">Upload, then build your edits — batch or one at a time.</p>
      </header>

      <section
        className={`dropzone ${isDraggingOver ? 'dropzone--active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={handleDrop}
      >
        <p>Drag photos here, or</p>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Add photos
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileInput}
          hidden
        />
        {isImporting && <p className="importing-note">Reading photos…</p>}
      </section>

      {images.length > 0 && (
        <div className="toolbar">
          <span>
            {images.length} photo{images.length === 1 ? '' : 's'}
            {selectedCount > 0 && ` · ${selectedCount} selected`}
          </span>
          <div className="toolbar-actions">
            <button type="button" onClick={selectAll}>
              Select all
            </button>
            <button type="button" onClick={clearSelection} disabled={selectedCount === 0}>
              Clear
            </button>
            <div className="preset-picker-wrap">
              <button
                type="button"
                disabled={selectedCount === 0 || presets.length === 0}
                title={presets.length === 0 ? 'Save a preset from the Editor first' : ''}
                onClick={() => setShowPresetPicker((v) => !v)}
              >
                Apply preset
              </button>
              {showPresetPicker && (
                <div className="preset-picker">
                  {applyingPreset ? (
                    <p className="preset-picker-status">Applying…</p>
                  ) : (
                    presets.map((p) => (
                      <button key={p.id} type="button" onClick={() => handleApplyPreset(p)}>
                        {p.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {images.length === 0 ? (
        <p className="empty-state">No photos yet — add some to get started.</p>
      ) : (
        <div className="grid">
          {images.map((img) => (
            <div
              key={img.id}
              className={`thumb ${img.selected ? 'thumb--selected' : ''}`}
              onClick={() => setEditingId(img.id)}
            >
              <img src={img.thumbUrl} alt={img.fileName} />
              <button
                type="button"
                className={`thumb-check ${img.selected ? 'thumb-check--on' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelect(img.id);
                }}
                aria-label={img.selected ? `Deselect ${img.fileName}` : `Select ${img.fileName}`}
              >
                {img.selected ? '✓' : ''}
              </button>
              <button
                type="button"
                className="thumb-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  removeImage(img.id);
                }}
                aria-label={`Remove ${img.fileName}`}
              >
                ×
              </button>
              <span className="thumb-name">
                {img.fileName} · {STATUS_LABELS[img.status]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
