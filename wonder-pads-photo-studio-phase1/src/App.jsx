import { useCallback, useEffect, useRef, useState } from 'react';
import { useLibrary } from './hooks/useLibrary';
import { useWatermark } from './hooks/useWatermark';
import { DEFAULT_LOOK_EDIT_STATE } from './utils/renderEdit';
import { renderFullEdit, makeThumbFromCanvas, downloadCanvas } from './utils/exportImage';
import { applyRecipeToPhoto, completeEditRecipe } from './utils/editRecipe';
import { SIZE_PRESETS, exportImagesAsZip, downloadBlob } from './utils/batchExport';
import { buildCollage } from './utils/collage';
import { removeBackgroundFromFile } from './utils/removeBackground';
import { useTextPresets } from './hooks/useTextPresets';
import TextTagPicker from './components/TextTagPicker';
import TextBlockLibrary from './components/TextBlockLibrary';
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
  const { logoCanvas, setLogoFile } = useWatermark();
  const {
    categories: tagCategories,
    addChip: addTagChip,
    textBlocks,
    addTextBlock,
    removeTextBlock,
  } = useTextPresets();

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [applyingWatermark, setApplyingWatermark] = useState(false);
  const [removingBgBatch, setRemovingBgBatch] = useState(false);
  const [bgBatchProgress, setBgBatchProgress] = useState(null);
  const [showTagPicker, setShowTagPicker] = useState(false);
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

  useEffect(() => {
    if (images.length === 0) {
      setActiveId(null);
      return;
    }
    if (!images.some((image) => image.id === activeId)) setActiveId(images[0].id);
  }, [images, activeId]);

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

  const handleRemoveImage = (id) => {
    const currentIndex = images.findIndex((image) => image.id === id);
    const nextActive = images[currentIndex + 1] || images[currentIndex - 1] || null;
    removeImage(id);
    if (activeId === id) setActiveId(nextActive?.id || null);
  };

  // Applies a saved preset's look to every currently-selected photo, one
  // at a time. Updates each photo's thumbnail and status in the library —
  // it doesn't trigger a download for each one; use Export for that.
  const handleApplyEditToSelected = async (sourceId, sourceEditState) => {
    const targets = images.filter((img) => img.selected);
    if (targets.length === 0) return 0;
    const sourcePhoto = images.find((img) => img.id === sourceId);
    const photosToUpdate =
      sourcePhoto && !sourcePhoto.selected ? [sourcePhoto, ...targets] : targets;

    for (const img of photosToUpdate) {
      const editState =
        img.id === sourceId
          ? completeEditRecipe(sourceEditState)
          : applyRecipeToPhoto(sourceEditState, img);

      let cutout = img.bgRemovedCanvas;
      if (editState.removeBackground && !cutout) {
        cutout = await removeBackgroundFromFile(img.file);
        setBgRemovedCanvas(img.id, cutout);
      }

      const outCanvas = await renderFullEdit(img.file, editState, cutout, logoCanvas);
      const newThumbUrl = await makeThumbFromCanvas(outCanvas);
      saveEdit(img.id, editState, newThumbUrl, 'edited');
    }

    return targets.length;
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

  // Tapping a tag immediately adds it as a new text layer to every
  // selected photo — on top of whatever text those photos already have,
  // not replacing it. Each photo can still be opened afterward to tweak
  // that one layer's wording for anything that doesn't quite fit (not
  // every liner in the batch is organic cotton, etc). Tap several tags
  // in a row (e.g. "7in", then "Liner") to stack up multiple labels.
  const handleApplyTextToSelected = async (text, style = {}) => {
    const targets = images.filter((img) => img.selected);
    if (targets.length === 0) return;
    setApplyingTagChips(true);
    let failCount = 0;
    for (const img of targets) {
      try {
        const base = img.editState || DEFAULT_LOOK_EDIT_STATE;
        const newLayer = {
          id: `text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          text,
          x: 0.5,
          y: 0.82,
          fontSizeFrac: 0.07,
          color: '#ffffff',
          bgColor: 'rgba(0,0,0,0.55)',
          ...style,
        };
        const editState = { ...base, textLayers: [...(base.textLayers || []), newLayer] };
        const outCanvas = await renderFullEdit(img.file, editState, img.bgRemovedCanvas, logoCanvas);
        const newThumbUrl = await makeThumbFromCanvas(outCanvas);
        saveEdit(img.id, editState, newThumbUrl, img.status === 'untouched' ? 'edited' : img.status);
      } catch (err) {
        failCount += 1;
        console.error(`Adding text failed for "${img.fileName}"`, err);
      }
    }
    setApplyingTagChips(false);
    if (failCount > 0) {
      alert(`The text didn't apply to ${failCount} of ${targets.length} photos. Please try again.`);
    }
  };

  const handleApplyTagChip = (chip) => handleApplyTextToSelected(chip);
  const handleApplyTextBlock = (block) =>
    handleApplyTextToSelected(block.text, { y: 0.72, fontSizeFrac: 0.055 });

  const activeImage = images.find((img) => img.id === activeId) || images[0] || null;
  const editingImage = images.find((img) => img.id === editingId);

  if (editingImage) {
    return (
      <Editor
        image={editingImage}
        onBgRemoved={setBgRemovedCanvas}
        onReset={resetImage}
        logoCanvas={logoCanvas}
        onSetLogo={setLogoFile}
        tagCategories={tagCategories}
        onAddTagChip={addTagChip}
        textBlocks={textBlocks}
        onAddTextBlock={addTextBlock}
        onRemoveTextBlock={removeTextBlock}
        onClose={() => setEditingId(null)}
        selectedCount={selectedCount}
        onApplyToSelected={handleApplyEditToSelected}
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
        <div className="brand-mark" aria-hidden="true">WP</div>
        <div>
          <p className="brand-eyebrow">Wonder Pads Reusables</p>
          <h1>Photo Studio</h1>
          <p className="app-subtitle">Prepare beautiful product photos, one thoughtful step at a time.</p>
        </div>
        {images.length > 0 && (
          <button type="button" className="header-add" onClick={() => fileInputRef.current?.click()}>
            + Add photos
          </button>
        )}
      </header>

      <section
        className={`dropzone ${images.length > 0 ? 'dropzone--compact' : ''} ${isDraggingOver ? 'dropzone--active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={handleDrop}
      >
        {images.length === 0 ? (
          <>
            <span className="dropzone-icon" aria-hidden="true">✦</span>
            <h2>Bring in your product photos</h2>
            <p>Select one photo or a whole batch. Originals always stay untouched.</p>
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              Choose photos
            </button>
          </>
        ) : (
          <p>Drop more photos anywhere in this area</p>
        )}
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
                Quick label
              </button>
              {showTagPicker && (
                <div className="preset-picker export-panel">
                  <p className="editor-hint">Add a quick label or saved text block to every selected photo.</p>
                  <TextTagPicker
                    categories={tagCategories}
                    onAddChip={addTagChip}
                    onPick={handleApplyTagChip}
                    disabled={applyingTagChips}
                  />
                  <TextBlockLibrary
                    blocks={textBlocks}
                    onAdd={addTextBlock}
                    onRemove={removeTextBlock}
                    onPick={handleApplyTextBlock}
                    disabled={applyingTagChips}
                  />
                  {applyingTagChips && <p className="preset-picker-status">Applying…</p>}
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

      {activeImage && (
        <div className="studio-workspace">
          <main className="studio-stage">
            <div className="stage-heading">
              <div>
                <span className={`status-pill status-pill--${activeImage.status}`}>
                  {STATUS_LABELS[activeImage.status]}
                </span>
                <h2>{activeImage.fileName}</h2>
              </div>
              <span className="image-count">
                {images.findIndex((image) => image.id === activeImage.id) + 1} of {images.length}
              </span>
            </div>

            <button type="button" className="canvas-stage" onClick={() => setEditingId(activeImage.id)}>
              <img src={activeImage.thumbUrl} alt={activeImage.fileName} />
              <span className="canvas-edit-hint">Tap to edit photo</span>
            </button>

            <div className="stage-actions">
              <button type="button" className="primary-action" onClick={() => setEditingId(activeImage.id)}>
                Edit this photo
              </button>
              <button type="button" onClick={() => toggleSelect(activeImage.id)}>
                {activeImage.selected ? '✓ Selected for batch' : 'Select for batch'}
              </button>
              <button type="button" className="quiet-danger" onClick={() => handleRemoveImage(activeImage.id)}>
                Remove
              </button>
            </div>
          </main>

          <section className="filmstrip-panel" aria-label="Uploaded photos">
            <div className="filmstrip-heading">
              <div>
                <p className="brand-eyebrow">Your batch</p>
                <h2>Uploaded photos</h2>
              </div>
              <span>{selectedCount} selected</span>
            </div>
            <div className="filmstrip">
              {images.map((img) => (
                <div
                  key={img.id}
                  className={`filmstrip-item ${img.id === activeImage.id ? 'filmstrip-item--active' : ''} ${img.selected ? 'filmstrip-item--selected' : ''}`}
                >
                  <button type="button" className="filmstrip-open" onClick={() => setActiveId(img.id)}>
                    <img src={img.thumbUrl} alt={img.fileName} />
                    <span>{img.fileName}</span>
                  </button>
                  <button
                    type="button"
                    className={`thumb-check ${img.selected ? 'thumb-check--on' : ''}`}
                    onClick={() => toggleSelect(img.id)}
                    aria-label={img.selected ? `Deselect ${img.fileName}` : `Select ${img.fileName}`}
                  >
                    {img.selected ? '✓' : ''}
                  </button>
                  <button
                    type="button"
                    className="thumb-remove"
                    onClick={() => handleRemoveImage(img.id)}
                    aria-label={`Remove ${img.fileName}`}
                  >
                    ×
                  </button>
                  <span className={`filmstrip-status filmstrip-status--${img.status}`}>{STATUS_LABELS[img.status]}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
