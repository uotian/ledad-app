'use client';
import { createContext, useContext, useEffect, useState } from 'react';
export type TextSize = 'S' | 'M' | 'L';
export const textSizeKey = 'ledad.text-size';
export function parseTextSize(value: string | null): TextSize {
  return value === 'M' || value === 'L' ? value : 'S';
}
const Context = createContext<{ size: TextSize; setSize: (size: TextSize) => void }>({
  size: 'S',
  setSize: () => {},
});
export const useTextSize = () => useContext(Context);
export default function TextSizeProvider({ children }: { children: React.ReactNode }) {
  const [size, update] = useState<TextSize>('S');
  useEffect(() => {
    const restore = () => {
      try {
        update(parseTextSize(localStorage.getItem(textSizeKey)));
      } catch {
        /* Use S. */
      }
    };
    restore();
    window.addEventListener('storage', restore);
    return () => window.removeEventListener('storage', restore);
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--text-scale',
      String({ S: 1, M: 1.15, L: 1.3 }[size]),
    );
  }, [size]);
  const setSize = (next: TextSize) => {
    try {
      localStorage.setItem(textSizeKey, next);
    } catch {
      /* Apply without persistence. */
    }
    update(next);
  };
  return <Context.Provider value={{ size, setSize }}>{children}</Context.Provider>;
}
