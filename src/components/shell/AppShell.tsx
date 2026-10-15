'use client';
import type { DragEvent, ReactNode } from 'react';
import { useAppClose } from '@/hooks/useAppClose';
import ErrorBanner from '@/components/ui/ErrorBanner';
import Sidebar from './Sidebar';
function preventFileNavigation(event: DragEvent) {
  if (event.dataTransfer.types.includes('Files')) event.preventDefault();
}
export default function AppShell({
  children,
  active,
  beforeClose,
  onHome,
}: {
  children: ReactNode;
  active?: 'home' | 'meeting' | 'records';
  beforeClose?: () => Promise<void>;
  onHome?: () => void;
}) {
  const closeError = useAppClose(beforeClose);
  return (
    <div className="app-shell" onDragOver={preventFileNavigation} onDrop={preventFileNavigation}>
      <Sidebar onHome={onHome} />
      <main className={`app-main ${active === 'meeting' ? 'meeting-main' : ''}`}>
        <ErrorBanner message={closeError} />
        {children}
      </main>
    </div>
  );
}
