// The part of a text that matches what was searched, marked - so the eye lands on why a result is there.

export function Highlight({ text, q }: { text: string; q: string }) {
  const t = q.trim();
  const i = t ? text.toLocaleLowerCase('he').indexOf(t.toLocaleLowerCase('he')) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="hl">{text.slice(i, i + t.length)}</mark>
      {text.slice(i + t.length)}
    </>
  );
}
