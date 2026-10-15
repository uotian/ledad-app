import { useState } from 'react';

export default function PromptChips({
  prompts,
  disabled,
  onSelect,
}: {
  prompts: string[];
  disabled: boolean;
  onSelect: (prompt: string) => void;
}) {
  const [held, setHeld] = useState<string[] | null>(null);
  return (
    <div
      className="prompt-chips"
      onPointerEnter={() => setHeld(prompts)}
      onPointerLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) setHeld(null);
      }}
      onFocusCapture={() => setHeld((value) => value ?? prompts)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHeld(null);
      }}
    >
      {(held ?? prompts).map((prompt, index) => (
        <button key={`${index}:${prompt}`} disabled={disabled} onClick={() => onSelect(prompt)}>
          {prompt}
        </button>
      ))}
    </div>
  );
}
