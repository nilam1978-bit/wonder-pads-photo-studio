import { useCallback, useRef, useState } from 'react';
import { useLibrary } from './hooks/useLibrary';
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

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [editingId, setEditingId] = useState(null);
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

  const editingImage = images.find((img) => img.id === editingId);

  if (editingImage) {
    return (
      <Editor
        image={editingImage}
        onClose={() => setEditingId(null)}
        onSave={(id, editState, newThumbUrl) => {
          saveEdit(id, editState, newThumbUrl);
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
            <button type="button" disabled title="Coming in Phase 3">
              Apply preset
            </button>
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
