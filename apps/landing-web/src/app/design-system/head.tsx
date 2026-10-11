import s from "./specimen.module.css";

/** A spread's header: the kicker on an ink strip, then the headline. */
export function Head({
  kicker,
  title,
  id,
  level = 2,
  children,
}: {
  kicker: string;
  title: React.ReactNode;
  id: string;
  level?: 2 | 3;
  children?: React.ReactNode;
}) {
  const Heading = `h${level}` as const;
  return (
    <header className={s.head}>
      <p className={s.kicker}>{kicker}</p>
      <Heading id={id} className={level === 2 ? s.title : s.sub}>
        {title}
      </Heading>
      {children}
    </header>
  );
}
