# Wonder Pads Studio — Final replacement build

Upload the contents of this folder to Netlify Drop with `index.html` at the site root.

This build includes the Wonder Pads Studio workflow, dedicated Silhouette Studio workstation, focused Edit/Compare canvas, PWA assets, automatic background removal, mobile-safe Cutout Editor, multi-page PDF pattern references, 36-point outer-boundary Auto silhouette, calibrated SVG export, device drafts, Saved Gallery patterns, and the pattern joining canvas.

## Focused Silhouette canvas

Open Silhouette Studio, load a photo or PDF, and press **Open canvas**. The compact ribbon provides Edit and Compare views plus Select, Add, Move, Straight, Curve, Delete, Undo, Redo, Focus/Show all, and Hide/Show handles. Review, Export SVG, and Close remain in the modal header.

## Multi-page PDF patterns

Use **Photo / PDF** and choose a PDF. Page 1 is rendered into the reference panel and tracing canvas. Use the previous and next page buttons to select another page; the status confirms the active page, for example `PDF page 2 of 5 is active on the tracing canvas`. The selected page becomes the source for manual tracing and Auto silhouette.

PDF.js and its worker are packaged locally under `assets/`, so PDF support does not depend on a CDN at runtime.

## Original PDF size

Mark the endpoints of a printed measurement using **Reference line**, enter that measurement under **Reference length**, then enable **Use original PDF/source size**. Calibration changes the exported physical dimensions but never changes the traced outline.

## Saved patterns and joining

Use **Save to Gallery** for every finished pattern piece. In Saved Gallery, select at least two silhouette cards and choose **Join patterns**. Position, rotate, resize or flip the pieces, then export one SVG containing the aligned paths.

## Mobile interaction

Use one finger to select and drag vector nodes or Bézier handles, and two fingers to zoom. The quick ribbon scrolls horizontally when necessary. The Cutout Editor Restore brush uses a brush-sized reusable canvas to avoid mobile Safari memory spikes.

Press Escape or the Close button to leave the focused canvas modal.

