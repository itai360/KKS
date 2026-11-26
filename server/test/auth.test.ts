import request from 'supertest';
import { resetLoginThrottle } from '../src/auth';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { clock, resetSettingsCache } from '../src/core';
import { openDb } from '../src/db';
import { login, NOW, setup, type Ctx } from './helpers';

describe('first-run setup', () => {
  beforeEach(() => {
    openDb(':memory:');
    resetSettingsCache();
    clock.set(NOW);
  });

  it('creates the course and the commander once', async () => {
    const app = createApp();
    const info = await request(app).get('/api/public/info');
    expect(info.body.needsSetup).toBe(true);

    const agent = request.agent(app);
    const res = await agent
      .post('/api/setup')
      .set('x-kks', '1')
      .send({ courseName: 'קורס קק"ס 2026', username: 'boss', password: 'secret123', displayName: 'סרן כהן' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('commander');

    const me = await agent.get('/api/auth/me');
    expect(me.body.settings.courseName).toBe('קורס קק"ס 2026');

    const again = await request(app)
      .post('/api/setup')
      .set('x-kks', '1')
      .send({ courseName: 'x', username: 'evil', password: 'secret123', displayName: 'x' });
    expect(again.status).toBe(403);
  });
});

describe('auth', () => {
  let c: Ctx;
  beforeEach(async () => {
    c = await setup();
  });

  it('rejects wrong passwords and throttles brute force', async () => {
    const bad = () => request(c.app).post('/api/auth/login').set('x-kks', '1').send({ username: 's1', password: 'nope' });
    expect((await bad()).status).toBe(401);
    for (let i = 0; i < 5; i++) await bad();
    expect((await bad()).status).toBe(429);
    // another instance (no attempts counted in its memory) still honours the lock
    resetLoginThrottle();
    expect((await bad()).status).toBe(429);
    const good = await request(c.app).post('/api/auth/login').set('x-kks', '1').send({ username: 's1', password: 'secret123' });
    expect(good.status).toBe(429); // the right password too, until the minute is up
  });

  it('requires a session for the API', async () => {
    expect((await request(c.app).get('/api/my')).status).toBe(401);
  });

  it('blocks state-changing requests without the CSRF header', async () => {
    const agent = request.agent(c.app);
    await agent.post('/api/auth/login').set('x-kks', '1').send({ username: 's1', password: 'secret123' });
    const res = await agent.post('/api/tasks').send({ title: 'x' });
    expect(res.status).toBe(403);
  });

  it('only the commander manages users and keeps at least one commander', async () => {
    expect((await c.s1.post('/api/users', { username: 'x1', password: 'secret123', displayName: 'x', role: 'staff' })).status).toBe(403);
    const created = await c.cmd.post('/api/users', { username: 'new1', password: 'secret123', displayName: 'מפק"צ 4', role: 'staff' });
    expect(created.status).toBe(200);
    const demote = await c.cmd.patch(`/api/users/${c.ids.cmd}`, { role: 'staff' });
    expect(demote.status).toBe(400);
  });

  it('deactivating a user ends their session', async () => {
    await c.cmd.patch(`/api/users/${c.ids.s3}`, { active: false });
    expect((await c.s3.get('/api/my')).status).toBe(401);
  });

  it('changes password', async () => {
    expect((await c.s1.post('/api/auth/password', { current: 'wrong', next: 'newpass1' })).status).toBe(400);
    expect((await c.s1.post('/api/auth/password', { current: 'secret123', next: 'newpass1' })).status).toBe(200);
    const res = await request(c.app).post('/api/auth/login').set('x-kks', '1').send({ username: 's1', password: 'newpass1' });
    expect(res.status).toBe(200);
  });

  it('a new password signs out the other devices, not this one; or sign them out without changing it', async () => {
    const phone = await login(c.app, 's2');
    const laptop = await login(c.app, 's2');
    expect((await c.s2.get('/api/auth/sessions')).body.others).toBe(2);
    const changed = await c.s2.post('/api/auth/password', { current: 'secret123', next: 'newpass1' });
    expect(changed.body.others).toBe(2);
    expect((await c.s2.get('/api/my')).status).toBe(200);
    expect((await phone.get('/api/my')).status).toBe(401);
    expect((await laptop.get('/api/my')).status).toBe(401);

    const again = await login(c.app, 's2', 'newpass1');
    expect((await c.s2.post('/api/auth/sessions/end-others')).body.others).toBe(1);
    expect((await again.get('/api/my')).status).toBe(401);
    expect((await c.s2.get('/api/my')).status).toBe(200);
    expect((await c.s2.get('/api/auth/sessions')).body.others).toBe(0);
  });

  it('an account the commander opened asks for a personal password on first sign-in', async () => {
    const created = await c.cmd.post('/api/users', { username: 'newbie', password: 'temp1234', displayName: 'מפק"צ חדש', role: 'staff' });
    expect(created.status).toBe(200);
    expect(created.body.mustChangePassword).toBeUndefined();
    const newbie = await login(c.app, 'newbie', 'temp1234');
    expect((await newbie.get('/api/auth/me')).body.mustChangePassword).toBe(true);
    // nobody else learns whose temporary password is still in use
    expect((await c.s1.get('/api/users')).body.every((u: Record<string, unknown>) => !('mustChangePassword' in u))).toBe(true);
    expect((await newbie.post('/api/auth/password/first', { next: 'temp1234' })).body.error).toBe('בחרו סיסמה שונה מהסיסמה שקיבלתם');
    expect((await newbie.post('/api/auth/password/first', { next: 'mine4567' })).status).toBe(200);
    expect((await newbie.get('/api/auth/me')).body.mustChangePassword).toBe(false);
    expect((await newbie.post('/api/auth/password/first', { next: 'again789' })).status).toBe(400);
    const res = await request(c.app).post('/api/auth/login').set('x-kks', '1').send({ username: 'newbie', password: 'temp1234' });
    expect(res.status).toBe(401);
    await login(c.app, 'newbie', 'mine4567');
  });

  it('a password the commander reset is temporary too; the person\'s own change makes it personal', async () => {
    await c.cmd.patch(`/api/users/${c.ids.s2}`, { password: 'reset123' });
    const s2 = await login(c.app, 's2', 'reset123');
    expect((await s2.get('/api/auth/me')).body.mustChangePassword).toBe(true);
    await s2.post('/api/auth/password', { current: 'reset123', next: 'personal9' });
    expect((await s2.get('/api/auth/me')).body.mustChangePassword).toBe(false);
    // existing accounts and the commander's own reset are not affected
    expect((await c.s1.get('/api/auth/me')).body.mustChangePassword).toBe(false);
    await c.cmd.patch(`/api/users/${c.ids.cmd}`, { password: 'cmdnew12' });
    const cmd = await login(c.app, 'cmd', 'cmdnew12');
    expect((await cmd.get('/api/auth/me')).body.mustChangePassword).toBe(false);
  });
});
