// A search result's text, as it is: what was typed is not marked in it (the commander asked for clean
// results - the list itself says what matched). Kept as a component so every search screen shows its
// results the same way.

export function Highlight({ text }: { text: string; q?: string }) {
  return <>{text}</>;
}
