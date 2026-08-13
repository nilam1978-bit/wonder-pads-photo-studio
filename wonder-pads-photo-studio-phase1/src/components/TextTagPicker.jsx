import { useState } from 'react';

export default function TextTagPicker({ categories, onAddChip, onPick, disabled }) {
  const [customInputs, setCustomInputs] = useState({});

  const handleAddCustom = (category) => {
    const value = customInputs[category] || '';
    onAddChip(category, value);
    setCustomInputs((prev) => ({ ...prev, [category]: '' }));
  };

  return (
    <div className="tagpicker">
      {Object.entries(categories).map(([category, chips]) => (
        <details key={category} className="tagpicker-category-dropdown">
          <summary>
            <span>{category}</span>
            <small>{chips.length} label{chips.length === 1 ? '' : 's'}</small>
          </summary>
          <div className="tagpicker-category">
            <div className="editor-fill-options">
              {chips.map((chip) => (
                <button key={chip} type="button" disabled={disabled} onClick={() => onPick(chip)}>
                  {chip}
                </button>
              ))}
              <input
                type="text"
                className="tagpicker-add-input"
                placeholder="+ add"
                value={customInputs[category] || ''}
                onChange={(e) => setCustomInputs((prev) => ({ ...prev, [category]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddCustom(category);
                }}
              />
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}
