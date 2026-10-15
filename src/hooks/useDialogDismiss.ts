import { useRef, type MouseEvent } from 'react';

function isBackdrop(event: MouseEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return false;
  const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom
  );
}

export function useDialogDismiss() {
  const pressed = useRef(false);
  return {
    onPointerDown(event: MouseEvent<HTMLDialogElement>) {
      pressed.current = isBackdrop(event);
    },
    onClick(event: MouseEvent<HTMLDialogElement>) {
      const dismiss = pressed.current && isBackdrop(event);
      pressed.current = false;
      if (dismiss) event.currentTarget.close();
    },
  };
}
