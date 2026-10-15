'use client';
import { useSyncExternalStore } from 'react';

const storageKey = 'ledad.analyzeIntervalSeconds';
const changed = 'ledad.analyzeIntervalChanged';
export const analyzeIntervals = [0, 3, 15, 30, 60] as const;
export type AnalyzeInterval = (typeof analyzeIntervals)[number];

function read(): AnalyzeInterval {
  try {
    const value = Number(
      localStorage.getItem(storageKey) ?? localStorage.getItem('ledad.insightIntervalSeconds'),
    );
    if (value === 180 || value === 300) return 60;
    return analyzeIntervals.includes(value as AnalyzeInterval) ? (value as AnalyzeInterval) : 0;
  } catch {
    return 0;
  }
}

function subscribe(notify: () => void) {
  window.addEventListener('storage', notify);
  window.addEventListener(changed, notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(changed, notify);
  };
}

export function useAnalyzeInterval() {
  return useSyncExternalStore(subscribe, read, () => 0);
}

export function saveAnalyzeInterval(value: AnalyzeInterval) {
  localStorage.setItem(storageKey, String(value));
  window.dispatchEvent(new Event(changed));
}
