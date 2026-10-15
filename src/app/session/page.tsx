import { Suspense } from 'react';
import SessionRoute from './SessionRoute';
export default function SessionPage() {
  return (
    <Suspense fallback={<p>会議を開いています…</p>}>
      <SessionRoute />
    </Suspense>
  );
}
