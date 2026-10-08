// A task's quick menu (held on a phone, right-clicked on a computer - see RowMenu.tsx): done, started,
// a day or a week later, open, copy its link - without opening it. Only what this person may do is
// offered; a deadline moved can be put back from the message that says so.

import { useNavigate } from 'react-router';
import { addDays } from '@shared/dates';
import type { Task } from '@shared/types';
import { api } from '../lib/api';
import { dateKeyOf, fmtDeadline, fmtTime, isoAt } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { isGrouped } from '../lib/taskGroups';
import { useSession } from '../lib/session';
import { useRowMenu, type RowMenuItem } from './RowMenu';
import { useToast } from './Toasts';
import type { useTaskTick } from './TaskRow';

export { unlessHeld } from './RowMenu';

/** The quick actions of one task row (see useRowMenu for what goes where). */
export function useTaskMenu(task: Task, tick: ReturnType<typeof useTaskTick>, disabled?: boolean) {
  const { user, isCommander, viewing } = useSession();
  const navigate = useNavigate();
  const toast = useToast();

  // a task given to several people moves for all of them - the row stands for the whole task
  const everyone = isGrouped(task) ? { allCopies: true } : {};
  const shift = async (days: number) => {
    const before = task.deadline;
    const next = isoAt(addDays(dateKeyOf(before), days), fmtTime(before));
    try {
      await api.patch(`/api/tasks/${task.id}`, { deadline: next, ...everyone });
      emitLocalChange('tasks');
      toast({
        title: `הדד-ליין זז ל${fmtDeadline(next)}`,
        body: task.title,
        tone: 'green',
        action: {
          label: 'ביטול',
          run: () =>
            void api
              .patch(`/api/tasks/${task.id}`, { deadline: before, ...everyone })
              .then(() => emitLocalChange('tasks'))
              .catch((e: Error) => toast({ title: e.message, tone: 'red' })),
        },
      });
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const start = async () => {
    try {
      await api.post(`/api/tasks/${task.id}/transition`, { action: 'start' });
      emitLocalChange('tasks');
      toast({ title: 'סומן "בטיפול"', body: task.title, tone: 'green' });
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const copy = async () => {
    const url = `${location.origin}/tasks/${task.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'הקישור למשימה הועתק', tone: 'green' });
    } catch {
      toast({ title: url, tone: 'gray' });
    }
  };

  const moves = !viewing && (isCommander || task.createdBy === user.id) && tick.open && !!task.deadline;
  const items: RowMenuItem[] = [
    ...(tick.canCheck && !tick.done ? [{ key: 'done', label: task.requiresApproval && !isCommander ? 'בוצע - לאישור' : 'בוצע', icon: 'check', primary: true, run: () => void tick.complete() }] : []),
    ...(tick.canCheck && task.status === 'todo' ? [{ key: 'start', label: 'התחלתי לטפל', icon: 'play', run: () => void start() }] : []),
    ...(moves ? [{ key: 'day', label: 'דחייה ביום', icon: 'clock', run: () => void shift(1) }] : []),
    ...(moves ? [{ key: 'week', label: 'דחייה בשבוע', icon: 'calendar', run: () => void shift(7) }] : []),
    { key: 'open', label: 'פתיחת המשימה', icon: 'chevronLeft', run: () => navigate(`/tasks/${task.id}`) },
    { key: 'copy', label: 'העתקת קישור', icon: 'link', run: () => void copy() },
  ];
  return useRowMenu({ title: task.title, items, disabled });
}

export type TaskMenu = ReturnType<typeof useTaskMenu>;
