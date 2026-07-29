import { DEFAULT_LOOK_EDIT_STATE, RATIOS, computeCenteredCrop } from './renderEdit';

export function completeEditRecipe(editState) {
  const source = editState || DEFAULT_LOOK_EDIT_STATE;
  return {
    ...DEFAULT_LOOK_EDIT_STATE,
    ...source,
    crop: { ...(source.crop || DEFAULT_LOOK_EDIT_STATE.crop) },
    fitFill: { ...(source.fitFill || DEFAULT_LOOK_EDIT_STATE.fitFill) },
    adjustments: {
      ...DEFAULT_LOOK_EDIT_STATE.adjustments,
      ...(source.adjustments || {}),
    },
    brushStrokes: (source.brushStrokes || []).map((stroke) => ({
      ...stroke,
      points: (stroke.points || []).map((point) => ({ ...point })),
    })),
    textLayers: (source.textLayers || []).map((layer) => ({ ...layer })),
    watermark: {
      ...DEFAULT_LOOK_EDIT_STATE.watermark,
      ...(source.watermark || {}),
    },
  };
}

// Crop coordinates belong to the source photo. When the same edit is
// applied to another photo, keep the intended ratio but calculate a safe
// centred crop for that photo's own dimensions. Fit mode remains uncropped.
export function applyRecipeToPhoto(sourceEditState, targetPhoto) {
  const recipe = completeEditRecipe(sourceEditState);
  if (recipe.mode === 'crop') {
    recipe.crop = computeCenteredCrop(
      targetPhoto.fullWidth,
      targetPhoto.fullHeight,
      RATIOS[recipe.ratioKey]
    );
  }
  return recipe;
}
