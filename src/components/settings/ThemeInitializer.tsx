'use client';
import { useEffect } from 'react';
import { applyTheme } from '@/lib/theme';
export default function ThemeInitializer() {
  useEffect(() => {
    applyTheme();
  }, []);
  return null;
}
