import type { ReactNode } from 'react';
export default function RecordSection({
  title,
  icon,
  items,
  empty,
}: {
  title: string;
  icon: ReactNode;
  items: string[];
  empty: string;
}) {
  return (
    <section className="card record-section">
      <h2>
        {icon}
        {title}
      </h2>
      {items.length ? (
        <ul>
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </section>
  );
}
