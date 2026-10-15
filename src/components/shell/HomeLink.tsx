'use client';
import type { ComponentProps } from 'react';
import Link from 'next/link';

export default function HomeLink({
  onHome,
  ...props
}: Omit<ComponentProps<typeof Link>, 'href' | 'onNavigate'> & { onHome?: () => void }) {
  return (
    <Link
      {...props}
      href="/"
      onNavigate={(event) => {
        if (!onHome) return;
        event.preventDefault();
        onHome();
      }}
    />
  );
}
