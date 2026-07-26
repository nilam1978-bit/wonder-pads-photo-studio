import { useCallback, useRef, useState } from 'react';
import { useLibrary } from './hooks/useLibrary';
import { usePresets } from './hooks/usePresets';
import { useWatermark } from './hooks/useWatermark';
import { RATIOS, DEFAULT_LOOK_EDIT_STATE, computeCenteredCrop } from './utils/renderEdit';
import { renderFullEdit, makeThumbFromCanvas, downloadCanvas } from './utils/exportImage';
import { SIZE_PRESETS, exportImagesAsZip, downloadBlob } from './utils/batchExport';
import { buildCollage } from './utils/collage';
import { removeBackgroundFromFile } from './utils/removeBackground';
import { useTextPresets } from './hooks/useTextPresets';
import TextTagPicker from './components/TextTagPicker';
import Editor from './components/Editor';
import './App.css';

const STATUS_LABELS = {
  untouched: 'Untouched',
  edited: 'Edited',
  preset: 'Preset applied',
};

const FORMATS = ['jpeg', 'png', 'webp'];
const GRID_OPTIONS = [
  { cols: 2, rows: 2 },
  { cols: 3, rows: 2 },
  { cols: 2, rows: 3 },
  { cols: 3, rows: 3 },
];

function App() {
  const {
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
  } = useLibrary();
  const { presets, addPreset } = usePresets();
  const { logoCanvas, setLogoFile } = useWatermark();
  const { categories: tagCategories, addChip: addTagChip } = useTextPresets();

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [showPresetPicker, setShowPresetPicker] = useState(false);
  const [applyingPreset, setApplyingPreset] = useState(false);
  const [applyingWatermark, setApplyingWatermark] = useState(false);
  const [removingBgBatch, setRemovingBgBatch] = useState(false);
  const [bgBatchProgress, setBgBatchProgress] = useState(null);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [selectedTagChips, setSelectedTagChips] = useState([]);
  const [applyingTagChips, setApplyingTagChips] = useState(false);

  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportFormat, setExportFormat] = useState('jpeg');
  const [exportSizePreset, setExportSizePreset] = useState('social');
  const [exportRename, setExportRename] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(null);

  const [showCollagePanel, setShowCollagePanel] = useState(false);
  const [collageGrid, setCollageGrid] = useState(GRID_OPTIONS[3]);
  const [buildingCollage, setBuildingCollage] = useState(false);
  const [collagePreviewUrl, setCollagePreviewUrl] = useState(null);
  const collageCanvasRef = useRef(null);

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

  const handleClearAll = () => {
    if (images.length === 0) return;
    const ok = window.confirm(
      `Remove all ${images.length} photo${images.length === 1 ? '' : 's'} from the library? Anything you haven't downloaded yet will be lost.`
    );
    if (ok) clearAll();
  };

  // Applies a saved preset's look to every currently-selected photo, one
  // at a time. Updates each photo's thumbnail and status in the library —
  // it doesn't trigger a download for each one; use Export for that.
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

  // Stamps the logo onto every selected photo, keeping whatever else is
  // already set on each one (crop, fill, adjustments) untouched.
  const handleApplyWatermark = async () => {
    if (!logoCanvas) return;
    setApplyingWatermark(true);
    const targets = images.filter((img) => img.selected);
    for (const img of targets) {
      const base = img.editState || DEFAULT_LOOK_EDIT_STATE;
      const editState = { ...base, watermark: { ...DEFAULT_LOOK_EDIT_STATE.watermark, ...base.watermark, enabled: true } };
      const outCanvas = await renderFullEdit(img.file, editState, img.bgRemovedCanvas, logoCanvas);
      const newThumbUrl = await makeThumbFromCanvas(outCanvas);
      saveEdit(img.id, editState, newThumbUrl, img.status === 'untouched' ? 'edited' : img.status);
    }
    setApplyingWatermark(false);
  };

  // Runs AI background removal on every selected photo that doesn't
  // already have a cached cutout, then turns "remove background" on for
  // each — keeping whatever crop/fill/adjustments they already have.
  // Photos are processed one at a time (not all at once), same reasoning
  // as everywhere else in the app: a big batch shouldn't freeze the tab.
  const handleBatchRemoveBackground = async () => {
    const targets = images.filter((img) => img.selected);
    if (targets.length === 0) return;
    setRemovingBgBatch(true);
    setBgBatchProgress({ done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      const img = targets[i];
      try {
        const cutout = img.bgRemovedCanvas || (await removeBackgroundFromFile(img.file));
        if (!img.bgRemovedCanvas) setBgRemovedCanvas(img.id, cutout);
        const base = img.editState || DEFAULT_LOOK_EDIT_STATE;
        const editState = { ...base, removeBackground: true };
        const outCanvas = await renderFullEdit(img.file, editState, cutout, logoCanvas);
        const newThumbUrl = await makeThumbFromCanvas(outCanvas);
        saveEdit(img.id, editState, newThumbUrl, img.status === 'untouched' ? 'edited' : img.status);
      } catch (err) {
        console.error(`Background removal failed for "${img.fileName}"`, err);
      }
      setBgBatchProgress({ done: i + 1, total: targets.length });
    }
    setRemovingBgBatch(false);
    setBgBatchProgress(null);
  };

  // Renders every selected photo at the chosen format/size (renamed by
  // pattern if given) and bundles them into one zip download. Every photo
  // that passes through this — even ones you never opened in the Editor —
  // comes out with its phone's EXIF/GPS metadata stripped, since that's
  // just how re-encoding through canvas works.
  const handleExport = async () => {
    const targets = images.filter((img) => img.selected);
    if (targets.length === 0) return;
    setExporting(true);
    setExportProgress({ done: 0, total: targets.length });
    try {
      const zipBlob = await exportImagesAsZip(
        targets,
        { format: exportFormat, sizePreset: exportSizePreset, renamePattern: exportRename.trim() || null },
        { logoCanvas, onProgress: (done, total) => setExportProgress({ done, total }) }
      );
      downloadBlob(zipBlob, 'wonder-pads-export.zip');
      setShowExportPanel(false);
    } catch (err) {
      console.error('Export failed', err);
    }
    setExporting(false);
    setExportProgress(null);
  };

  // Builds the collage and shows it before anything downloads, so you can
  // actually check the arrangement looks right first.
  const handlePreviewCollage = async () => {
    const targets = images.filter((img) => img.selected);
    if (targets.length < 2) return;
    setBuildingCollage(true);
    try {
      const canvas = await buildCollage(targets, collageGrid.cols, collageGrid.rows, { logoCanvas });
      collageCanvasRef.current = canvas;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      setCollagePreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (err) {
      console.error('Collage failed', err);
    }
    setBuildingCollage(false);
  };

  const handleDownloadCollage = () => {
    if (collageCanvasRef.current) downloadCanvas(collageCanvasRef.current, 'wonder-pads-collage.jpg');
  };

  const handleCollageGridChange = (g) => {
    setCollageGrid(g);
    setCollagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  // Builds one label from whichever tag chips are selected (e.g. "7in ·
  // Liner · Cotton Topper") and adds it as a new text layer to every
  // selected photo — on top of whatever text those photos already have,
  // not replacing it. Each photo can still be opened afterward to tweak
  // that one layer's wording for anything that doesn't quite fit (not
  // every liner in the batch is organic cotton, etc).
  const handleApplyTagChips = async () => {
    const targets = images.filter((img) => img.selected);
    if (targets.length === 0 || selectedTagChips.length === 0) return;
    setApplyingTagChips(true);
    const text = selectedTagChips.join(' · ');
    for (const img of targets) {
      const base = img.editState || DEFAULT_LOOK_EDIT_STATE;
      const newLayer = {
        id: `text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text,
        x: 0.5,
        y: 0.82,
        fontSizeFrac: 0.07,
        color: '#ffffff',
        bgColor: null,
      };
      const editState = { ...base, textLayers: [...(base.textLayers || []), newLayer] };
      const outCanvas = await renderFullEdit(img.file, editState, img.bgRemovedCanvas, logoCanvas);
      const newThumbUrl = await makeThumbFromCanvas(outCanvas);
      saveEdit(img.id, editState, newThumbUrl, img.status === 'untouched' ? 'edited' : img.status);
    }
    setApplyingTagChips(false);
    setSelectedTagChips([]);
    setShowTagPicker(false);
  };

  const toggleTagChip = (chip) => {
    setSelectedTagChips((prev) => (prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip]));
  };

  const editingImage = images.find((img) => img.id === editingId);

  if (editingImage) {
    return (
      <Editor
        image={editingImage}
        presets={presets}
        onAddPreset={addPreset}
        onBgRemoved={setBgRemovedCanvas}
        onReset={resetImage}
        logoCanvas={logoCanvas}
        onSetLogo={setLogoFile}
        tagCategories={tagCategories}
        onAddTagChip={addTagChip}
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
            <button
              type="button"
              disabled={selectedCount === 0 || removingBgBatch}
              onClick={handleBatchRemoveBackground}
              title="Runs AI background removal on every selected photo"
            >
              {removingBgBatch
                ? `Removing ${bgBatchProgress ? `${bgBatchProgress.done}/${bgBatchProgress.total}` : ''}…`
                : 'Remove background (all)'}
            </button>
            <button
              type="button"
              disabled={selectedCount === 0 || !logoCanvas || applyingWatermark}
              title={!logoCanvas ? "Upload your logo from any photo's editor first" : ''}
              onClick={handleApplyWatermark}
            >
              {applyingWatermark ? 'Stamping…' : 'Add watermark'}
            </button>
            <div className="preset-picker-wrap">
              <button type="button" disabled={selectedCount === 0} onClick={() => setShowTagPicker((v) => !v)}>
                Add text tag
              </button>
              {showTagPicker && (
                <div className="preset-picker export-panel">
                  <TextTagPicker
                    categories={tagCategories}
                    onAddChip={addTagChip}
                    selected={selectedTagChips}
                    onToggle={toggleTagChip}
                    onApply={handleApplyTagChips}
                    applying={applyingTagChips}
                    applyLabel="Apply to selected"
                  />
                </div>
              )}
            </div>
            <div className="preset-picker-wrap">
              <button type="button" disabled={selectedCount === 0} onClick={() => setShowExportPanel((v) => !v)}>
                Export
              </button>
              {showExportPanel && (
                <div className="preset-picker export-panel">
                  <span className="editor-fill-label">Format</span>
                  <div className="editor-fill-options">
                    {FORMATS.map((f) => (
                      <button key={f} type="button" className={exportFormat === f ? 'active' : ''} onClick={() => setExportFormat(f)}>
                        {f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <span className="editor-fill-label">Size</span>
                  <div className="editor-fill-options">
                    {Object.entries(SIZE_PRESETS).map(([key, p]) => (
                      <button
                        key={key}
                        type="button"
                        className={exportSizePreset === key ? 'active' : ''}
                        onClick={() => setExportSizePreset(key)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <span className="editor-fill-label">Rename (optional)</span>
                  <input
                    type="text"
                    className="editor-preset-input"
                    placeholder="e.g. moonrise-floral"
                    value={exportRename}
                    onChange={(e) => setExportRename(e.target.value)}
                  />
                  <button type="button" onClick={handleExport} disabled={exporting} className="export-go-button">
                    {exporting
                      ? `Exporting ${exportProgress ? `${exportProgress.done}/${exportProgress.total}` : ''}…`
                      : 'Download zip'}
                  </button>
                </div>
              )}
            </div>
            <div className="preset-picker-wrap">
              <button type="button" disabled={selectedCount < 2} onClick={() => setShowCollagePanel((v) => !v)}>
                Make collage
              </button>
              {showCollagePanel && (
                <div className="preset-picker export-panel">
                  <span className="editor-fill-label">Grid</span>
                  <div className="editor-fill-options">
                    {GRID_OPTIONS.map((g) => (
                      <button
                        key={`${g.cols}x${g.rows}`}
                        type="button"
                        className={collageGrid.cols === g.cols && collageGrid.rows === g.rows ? 'active' : ''}
                        onClick={() => handleCollageGridChange(g)}
                      >
                        {g.cols}×{g.rows}
                      </button>
                    ))}
                  </div>
                  <p className="editor-hint">
                    Uses the first {collageGrid.cols * collageGrid.rows} selected photos, in the order they appear above.
                  </p>
                  {collagePreviewUrl && (
                    <img src={collagePreviewUrl} alt="Collage preview" className="collage-preview" />
                  )}
                  {collagePreviewUrl ? (
                    <>
                      <button type="button" onClick={handleDownloadCollage} className="export-go-button">
                        Download collage
                      </button>
                      <button type="button" onClick={handlePreviewCollage} disabled={buildingCollage}>
                        {buildingCollage ? 'Rebuilding…' : 'Rebuild preview'}
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={handlePreviewCollage} disabled={buildingCollage} className="export-go-button">
                      {buildingCollage ? 'Building…' : 'Preview collage'}
                    </button>
                  )}
                </div>
              )}
            </div>
            <button type="button" className="toolbar-danger" onClick={handleClearAll}>
              Clear all
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
