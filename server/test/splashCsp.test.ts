import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createApp } from '../src/app';

it('allows the served pre-paint boot policy by its exact hash without allowing arbitrary inline scripts', async () => {
  const app = createApp({ staticDir: fileURLToPath(new URL('../../client', import.meta.url)) });
  const response = await request(app).get('/overview').expect(200).expect('Content-Type', /html/);
  const bootPolicy = response.text.match(/<script id="boot-policy">([\s\S]*?)<\/script>/)?.[1];
  expect(bootPolicy).toBeTruthy();

  const policy = response.headers['content-security-policy'] as string;
  expect(policy).toBeTruthy();
  const directives = new Map(policy.split(';').map((directive) => {
    const [name, ...sources] = directive.trim().split(/\s+/);
    return [name, sources] as const;
  }));
  // script-src-elem overrides script-src for these script elements if one is added later.
  const sources = directives.get('script-src-elem') ?? directives.get('script-src') ?? directives.get('default-src') ?? [];
  const hash = (script: string) => `'sha256-${createHash('sha256').update(script).digest('base64')}'`;
  const expected = hash(bootPolicy!);
  expect(sources).toContain(expected);
  expect(sources).not.toContain("'unsafe-inline'");
  expect(sources.filter((source) => /^'sha(?:256|384|512)-/.test(source))).toEqual([expected]);
  expect(sources).not.toContain(hash('window.arbitraryInlineScriptRan = true;'));
});
