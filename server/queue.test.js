import { describe, it, expect } from 'vitest';
import { JobQueue } from './queue.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('JobQueue', () => {
  it('runs tasks one at a time, in order', async () => {
    const queue = new JobQueue();
    const events = [];
    let release;
    const gate = new Promise((r) => (release = r));

    const first = queue.push(async () => {
      events.push('a-start');
      await gate;
      events.push('a-end');
    });
    const second = queue.push(async () => {
      events.push('b-start');
    });

    await tick();
    expect(events).toEqual(['a-start']); // b must not start while a runs
    expect(queue.length).toBe(2);

    release();
    await Promise.all([first, second]);
    expect(events).toEqual(['a-start', 'a-end', 'b-start']);
    expect(queue.length).toBe(0);
  });

  it('keeps draining after a task throws', async () => {
    const queue = new JobQueue();
    const failing = queue.push(async () => {
      throw new Error('boom');
    });
    const next = queue.push(async () => 'ok');

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('resolves with the task return value', async () => {
    const queue = new JobQueue();
    await expect(queue.push(async () => 42)).resolves.toBe(42);
  });
});
