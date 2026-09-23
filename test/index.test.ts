import { describe, expect, it, vi } from 'vitest';

const runMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/main.js', () => ({ run: runMock }));

describe('index.ts', () => {
  it('should run the action on import and re-export run for local-action', async () => {
    const entrypoint = await import('../src/index');

    expect(runMock).toHaveBeenCalledOnce();
    expect(entrypoint.run).toBe(runMock);
  });
});
