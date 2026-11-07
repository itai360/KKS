// The menu's topics (ניהול משימות, תכנון הקורס, צוערים...): the menu holds the topics alone, a topic opens the
// screen of it last used (or its first), and its screens are tabs at the top of the page (SectionTabs).

export interface TopicScreen {
  to: string;
  end?: boolean;
}

/** the screen of these the address is on - the screen itself, or one under it (a task of the tasks' list);
 * the longest match, so /reports/weekly is not taken for /reports */
export function screenAt<T extends TopicScreen>(path: string, items: T[]): T | undefined {
  let best: T | undefined;
  for (const it of items) {
    const on = it.end ? path === it.to : path === it.to || path.startsWith(`${it.to}/`);
    if (on && (!best || it.to.length > best.to.length)) best = it;
  }
  return best;
}

const KEY = 'kks.topicLast';

/** the screen last used in each topic, on this device */
export function lastScreens(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function noteTopicScreen(topic: string, to: string): void {
  const all = lastScreens();
  if (all[topic] === to) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...all, [topic]: to }));
  } catch {
    /* this visit only */
  }
}

/** where a topic opens: the screen of it last used, while it is still one of its screens - else its first */
export function topicTarget(topic: string, items: TopicScreen[], last: Record<string, string> = lastScreens()): string {
  const to = last[topic];
  return to && items.some((it) => it.to === to) ? to : (items[0]?.to ?? '/');
}
