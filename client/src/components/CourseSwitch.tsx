// Moving between the courses open side by side - the current one, and one opened beside it for the next cycle
// (server/src/parallel.ts): in the person's menu, and a line under the top bar while working in the one beside.

import { enterCourse } from '../lib/courses';
import { useSession } from '../lib/session';
import { Icon } from './Icon';
import { useToast } from './Toasts';

/** the courses to move between, in a menu - none when there is only the current one */
export function CourseMenuItems({ itemClass, iconSize, close }: { itemClass: string; iconSize: number; close: () => void }) {
  const { parallel } = useSession();
  const toast = useToast();
  if (!parallel) return null;
  const here = parallel.slot?.id ?? null;
  const courses = [{ id: null as number | null, name: parallel.main }, ...parallel.slots];
  return (
    <div role="group" aria-label="קורסים" className="course-menu">
      <div className="course-menu-label">קורסים</div>
      {courses.map((c) => (
        <button
          key={c.id ?? 'main'}
          type="button"
          role="menuitemradio"
          aria-checked={c.id === here}
          className={itemClass}
          onClick={() => {
            close();
            if (c.id !== here) enterCourse(c.id).catch((e: Error) => toast({ title: e.message, tone: 'red' }));
          }}
        >
          <Icon name={c.id === null ? 'flag' : 'layers'} size={iconSize} />
          <span className="grow">
            {c.name}
            <span className="tiny muted course-menu-sub">{c.id === null ? 'הקורס הנוכחי' : 'נפתח לצד הנוכחי'}</span>
          </span>
          {c.id === here && <Icon name="check" size={16} />}
        </button>
      ))}
    </div>
  );
}

/** working in the course opened beside the current one: said under the top bar, with the way back */
export function CourseBesideBar() {
  const { parallel } = useSession();
  const toast = useToast();
  if (!parallel?.slot) return null;
  return (
    <div className="update-bar course-bar is-beside no-print" role="status">
      <Icon name="layers" size={16} />
      <span className="grow">
        עובדים ב<b>{parallel.slot.name}</b>, לצד הקורס הנוכחי - מה שנעשה כאן נשאר בו.
      </span>
      <button className="btn btn-sm" title={`מעבר ל${parallel.main}`} onClick={() => enterCourse(null).catch((e: Error) => toast({ title: e.message, tone: 'red' }))}>
        לקורס הנוכחי
      </button>
    </div>
  );
}
