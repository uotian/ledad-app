import { useLayoutEffect, useRef } from 'react';

export function useAutoResizeTextarea(text: string) {
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    function resize() {
      if (!element || !element.clientWidth) return;
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
    }
    resize();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      resize();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);
  return input;
}
