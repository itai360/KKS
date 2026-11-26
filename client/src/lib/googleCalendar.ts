// One event in Google Calendar, added at once: the link opens Google Calendar (the app, on a phone) with the
// event filled in - the person saves it there. The subscribed feed (settings in the schedule) catches up only
// every few hours; this is for "now".

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function googleEventUrl(e: { title: string; start: Date; end: Date; details?: string }): string {
  const q = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates: `${stamp(e.start)}/${stamp(e.end)}`, details: e.details ?? '' });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** a task: half an hour that ends at its deadline, with a link back to it - as in the feed */
export function taskGoogleUrl(t: { id: number; title: string; deadline: string; description?: string }): string {
  const end = new Date(t.deadline);
  const about = t.description && t.description.length > 400 ? `${t.description.slice(0, 400)}…` : t.description;
  return googleEventUrl({
    title: `משימה: ${t.title}`,
    start: new Date(end.getTime() - 30 * 60_000),
    end,
    details: [about, `${location.origin}/tasks/${t.id}`].filter(Boolean).join('\n'),
  });
}
