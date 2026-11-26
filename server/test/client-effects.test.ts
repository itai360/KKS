// React calls whatever an effect returns as its cleanup. An effect written as
// `useEffect(() => someCall(), ...)` returns someCall's value; when a browser
// starts returning something from that call (Chrome now returns a promise from
// window.scrollTo), React crashes on the next screen change. Effects with a
// one-line body may only return an unsubscribe function (onStatus, onChange...).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe('client effects', () => {
  it('never return a value by accident', () => {
    const bad: string[] = [];
    for (const file of sources(join(__dirname, '../../client/src'))) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const m = /use(?:Layout)?Effect\(\(\) => (?!\{)(.*)/.exec(line);
          if (m && !/^on[A-Z]\w*\(/.test(m[1])) bad.push(`${file.split('client/src/')[1]}:${i + 1}  ${line.trim()}`);
        });
    }
    expect(bad).toEqual([]);
  });
});
