export function SectionHeading({
  id,
  index,
  label,
  title,
  accent,
}: {
  id: string;
  index: string;
  label: string;
  title: string;
  accent: string;
}) {
  return (
    <div className="section-heading" data-reveal>
      <p className="og-eyebrow section-index">
        <span>{index}</span>
        <span aria-hidden="true" className="section-rule" />
        <span>{label}</span>
      </p>
      <h2 id={id} className="section-title">
        <span>{title}</span> <span className="og-accent">{accent}</span>
      </h2>
    </div>
  );
}
