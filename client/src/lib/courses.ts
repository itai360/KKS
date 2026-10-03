import { api } from './api';

/** opens a previous course for reading (null: back to the current one) - every screen loads again */
export async function switchCourse(id: number | null): Promise<void> {
  await api.post('/api/courses/view', { id });
  window.location.assign(id === null ? '/courses' : '/');
}
