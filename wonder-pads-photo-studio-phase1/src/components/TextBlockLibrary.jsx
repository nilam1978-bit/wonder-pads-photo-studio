import { useState } from 'react';

export default function TextBlockLibrary({ blocks, onAdd, onRemove, onPick, disabled }) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [text, setText] = useState('');

  const handleSave = () => {
    if (!onAdd(name, text)) return;
    setName('');
    setText('');
    setShowCreate(false);
  };

  return (
    <section className="text-library">
      <div className="text-library-header">
        <div>
          <strong>My Text Library</strong>
          <span>Saved product information and descriptions</span>
        </div>
        <button type="button" onClick={() => setShowCreate((value) => !value)}>
          {showCreate ? 'Cancel' : '+ New text block'}
        </button>
      </div>

      {showCreate && (
        <div className="text-library-form">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name, e.g. 10in Regular Cotton"
          />
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={'10in Regular Pad\nCotton topper\nHidden PUL · Fleece backed'}
            rows={4}
          />
          <button type="button" onClick={handleSave} disabled={!name.trim() || !text.trim()}>
            Save to my library
          </button>
        </div>
      )}

      {blocks.length === 0 ? (
        <p className="text-library-empty">Create a text block once, then reuse it on any photo.</p>
      ) : (
        <div className="text-library-list">
          {blocks.map((block) => (
            <div key={block.id} className="text-library-item">
              <button type="button" className="text-library-apply" disabled={disabled} onClick={() => onPick(block)}>
                <strong>{block.name}</strong>
                <span>{block.text}</span>
              </button>
              <button
                type="button"
                className="text-library-remove"
                aria-label={`Delete ${block.name}`}
                onClick={() => onRemove(block.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
