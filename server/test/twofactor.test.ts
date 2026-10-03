// Two-step sign-in: codes that match the authenticator apps, turning it on and off, signing in
// with a code or a backup code, and the limits on a ticket.

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { clock } from '../src/core';
import { db } from '../src/db';
import { base32Decode, base32Encode, totp } from '../src/twofactor';
import { NOW, setup, type Ctx } from './helpers';

describe('codes (RFC 6238)', () => {
  it('match the standard test vectors and the apps\' secret format', () => {
    const secret = Buffer.from('12345678901234567890');
    expect(totp(secret, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(totp(secret, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(totp(secret, Math.floor(20000000000 / 30), 8)).toBe('65353130');
    expect(base32Encode(secret)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq').equals(secret)).toBe(true);
  });
});

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

const codeAt = (secret: string, at: Date) => totp(base32Decode(secret), Math.floor(at.getTime() / 30_000));
const later = (s: number) => new Date(NOW.getTime() + s * 1000);
const signIn = (username: string, password = 'secret123') => request(c.app).post('/api/auth/login').set('x-kks', '1').send({ username, password });

/** turns it on for a user and returns the secret and backup codes */
async function turnOn(agent: Ctx['cmd']) {
  const setupRes = await agent.post('/api/auth/2fa/setup', { password: 'secret123' });
  expect(setupRes.status).toBe(200);
  const { secret, uri } = setupRes.body as { secret: string; uri: string };
  expect(uri).toMatch(/^otpauth:\/\/totp\/.+\?secret=[A-Z2-7]+&issuer=/);
  const on = await agent.post('/api/auth/2fa/enable', { code: codeAt(secret, NOW) });
  expect(on.status).toBe(200);
  return { secret, recovery: on.body.recoveryCodes as string[] };
}

describe('two-step sign-in', () => {
  it('turns on only with the password and a first code from the app, and signs out the other devices', async () => {
    const other = request.agent(c.app);
    await other.post('/api/auth/login').set('x-kks', '1').send({ username: 'cmd', password: 'secret123' });
    expect((await c.cmd.post('/api/auth/2fa/setup', { password: 'wrong-pass1' })).status).toBe(400);
    const { secret } = (await c.cmd.post('/api/auth/2fa/setup', { password: 'secret123' })).body;
    expect((await c.cmd.post('/api/auth/2fa/enable', { code: '000000' })).body.error).toContain('הקוד שגוי');
    const on = await c.cmd.post('/api/auth/2fa/enable', { code: codeAt(secret, NOW) });
    expect(on.body.recoveryCodes).toHaveLength(10);
    expect(on.body.others).toBe(1);
    expect((await other.get('/api/auth/me')).status).toBe(401); // the other device is signed out
    expect((await c.cmd.get('/api/auth/me')).body).toMatchObject({ user: { twoFactor: true }, recoveryLeft: 10 });
  });

  it('after the password comes the code: no session before it, each code works once', async () => {
    const { secret } = await turnOn(c.cmd);
    const first = await signIn('cmd');
    expect(first.body).toEqual({ twoFactor: true, ticket: expect.any(String) });
    expect(first.headers['set-cookie']).toBeUndefined(); // no session yet
    // the code used to turn it on cannot be used again
    expect((await request(c.app).post('/api/auth/2fa/verify').set('x-kks', '1').send({ ticket: first.body.ticket, code: codeAt(secret, NOW) })).status).toBe(401);
    clock.set(later(30));
    const ok = await request(c.app).post('/api/auth/2fa/verify').set('x-kks', '1').send({ ticket: first.body.ticket, code: codeAt(secret, later(30)) });
    expect(ok.status).toBe(200);
    expect(String(ok.headers['set-cookie'])).toContain('kks_session=');
    // the ticket is spent
    expect((await request(c.app).post('/api/auth/2fa/verify').set('x-kks', '1').send({ ticket: first.body.ticket, code: codeAt(secret, later(30)) })).status).toBe(401);
  });

  it('a backup code works once; a ticket gives 5 tries and 5 minutes', async () => {
    const { secret, recovery } = await turnOn(c.cmd);
    const verify = (ticket: string, code: string) => request(c.app).post('/api/auth/2fa/verify').set('x-kks', '1').send({ ticket, code });
    const t1 = (await signIn('cmd')).body.ticket;
    expect((await verify(t1, recovery[0].toUpperCase())).status).toBe(200);
    const t2 = (await signIn('cmd')).body.ticket;
    expect((await verify(t2, recovery[0])).status).toBe(401);
    expect((await c.cmd.get('/api/auth/me')).body.recoveryLeft).toBe(9);

    // five tries per ticket: a right code after five misses is too late
    const t3 = (await signIn('cmd')).body.ticket;
    for (let i = 0; i < 5; i++) await verify(t3, '111111');
    clock.set(later(60));
    expect((await verify(t3, codeAt(secret, later(60)))).status).toBe(401);
    // three misses after a right password: the person is told
    expect(db().all<{ title: string }>("SELECT title FROM notifications WHERE user_id = ? AND type = 'security'", c.ids.cmd)).toHaveLength(1);
    // five minutes per ticket
    const t4 = (await signIn('cmd')).body.ticket;
    clock.set(later(60 + 6 * 60));
    expect((await verify(t4, codeAt(secret, later(60 + 6 * 60)))).body.error).toContain('פג תוקף');
  });

  it('misses across new tickets lock the code step for the person', async () => {
    const { secret } = await turnOn(c.cmd);
    for (let t = 0; t < 2; t++) {
      const ticket = (await signIn('cmd')).body.ticket;
      for (let i = 0; i < 5; i++) await request(c.app).post('/api/auth/2fa/verify').set('x-kks', '1').set('X-Forwarded-For', `198.51.100.${t * 10 + i}`).send({ ticket, code: '222222' });
    }
    clock.set(later(30));
    const ticket = (await signIn('cmd')).body.ticket;
    expect((await request(c.app).post('/api/auth/2fa/verify').set('x-kks', '1').send({ ticket, code: codeAt(secret, later(30)) })).status).toBe(429);
  });

  it('turning it off takes the password and a code; the commander can turn it off for someone who lost the phone', async () => {
    const { secret } = await turnOn(c.s1);
    expect((await c.s1.post('/api/auth/2fa/disable', { password: 'secret123', code: '123456' })).status).toBe(400);
    // the commander sees who has it; staff do not
    expect(((await c.cmd.get('/api/users')).body as { id: number; twoFactor?: boolean }[]).find((u) => u.id === c.ids.s1)?.twoFactor).toBe(true);
    expect(((await c.s2.get('/api/users')).body as { twoFactor?: boolean }[]).some((u) => 'twoFactor' in u)).toBe(false);
    expect((await c.cmd.patch(`/api/users/${c.ids.cmd}`, { resetTwoFactor: true })).status).toBe(400);
    await c.cmd.patch(`/api/users/${c.ids.s1}`, { resetTwoFactor: true });
    expect((await signIn('s1')).body.user).toBeTruthy(); // the password alone again
    expect(secret).toBeTruthy();
  });

  it('with a session and the password, the code still cannot be guessed to turn it off', async () => {
    const { secret } = await turnOn(c.cmd);
    for (let i = 0; i < 10; i++) expect((await c.cmd.post('/api/auth/2fa/disable', { password: 'secret123', code: String(100000 + i) })).status).toBe(400);
    clock.set(later(30));
    // locked for the person: even the right code waits
    expect((await c.cmd.post('/api/auth/2fa/disable', { password: 'secret123', code: codeAt(secret, later(30)) })).status).toBe(429);
    expect((await c.cmd.get('/api/auth/me')).body.user.twoFactor).toBe(true);
  });

  it('the first code is not guessed endlessly either', async () => {
    await c.cmd.post('/api/auth/2fa/setup', { password: 'secret123' });
    for (let i = 0; i < 10; i++) await c.cmd.post('/api/auth/2fa/enable', { code: String(200000 + i) });
    expect((await c.cmd.post('/api/auth/2fa/enable', { code: '123456' })).status).toBe(429);
  });

  it('the person is told when the commander turns it off for them', async () => {
    await turnOn(c.s1);
    await c.cmd.patch(`/api/users/${c.ids.s1}`, { resetTwoFactor: true });
    const n = db().all<{ title: string; link: string }>("SELECT title, link FROM notifications WHERE user_id = ? AND type = 'security'", c.ids.s1);
    expect(n).toEqual([{ title: 'האימות הדו-שלבי שלך בוטל', link: '/settings#security' }]);
  });

  it('new backup codes replace the old ones', async () => {
    const { secret, recovery } = await turnOn(c.cmd);
    clock.set(later(30));
    const again = await c.cmd.post('/api/auth/2fa/recovery', { password: 'secret123', code: codeAt(secret, later(30)) });
    expect(again.body.recoveryCodes).toHaveLength(10);
    const t = (await signIn('cmd')).body.ticket;
    expect((await request(c.app).post('/api/auth/2fa/verify').set('x-kks', '1').send({ ticket: t, code: recovery[1] })).status).toBe(401);
    expect((await request(c.app).post('/api/auth/2fa/verify').set('x-kks', '1').send({ ticket: t, code: again.body.recoveryCodes[0] })).status).toBe(200);
  });
});
