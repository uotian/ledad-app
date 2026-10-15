'use client';
import { useSearchParams } from 'next/navigation';
import SessionWorkspace from '@/components/SessionWorkspace';
export default function SessionRoute() {
  const id = useSearchParams().get('id');
  return id ? <SessionWorkspace key={id} id={id} /> : <p>会議が指定されていません。</p>;
}
