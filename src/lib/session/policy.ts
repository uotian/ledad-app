import type { Session } from './schema';

export function documentsPending(session: Session) {
  return (
    (session.documents.length > 0 && session.documentReference === null) ||
    session.documents.some((d) => d.preparationPending) ||
    (session.documentReference !== null &&
      JSON.stringify(session.documentReference.documentIds) !==
        JSON.stringify(session.documents.map((d) => d.id)))
  );
}

export function documentsFor(session: Session | null) {
  const reference = session?.documentReference;
  return reference?.documentIds.length &&
    reference.documentIds.every((id) => session!.documents.some((d) => d.id === id))
    ? reference.summary
    : '';
}
