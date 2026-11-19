import { describe, expect, it } from 'vitest';
import { publishedEntry, runningEntry } from './updates';

const docWith = (...srcs: string[]) => ({ querySelectorAll: () => srcs.map((src) => ({ getAttribute: () => src })) }) as unknown as Document;

describe('new version check', () => {
  it('reads the hashed main script this tab is running', () => {
    expect(runningEntry(docWith('https://cdn.example/x.js', '/assets/index-DakVytxk.js'))).toBe('assets/index-DakVytxk.js');
    expect(runningEntry(docWith('/src/main.tsx'))).toBe('');
  });

  it('reads the main script named by the published page', () => {
    expect(publishedEntry('<script type="module" crossorigin src="/assets/index-Ab_9-x.js"></script>')).toBe('assets/index-Ab_9-x.js');
    expect(publishedEntry('<html>maintenance</html>')).toBe('');
  });
});
