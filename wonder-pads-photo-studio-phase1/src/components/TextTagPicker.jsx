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
        <div key={category} className="tagpicker-category">
          <span className="editor-fill-label">{category}</span>
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
      ))}
    </div>
  );
}
