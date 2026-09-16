import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { requestSchemas, matchViewSchema, ackSchema } from './src/index.js';

it('normalizes names and codes but rejects invalid presets and overlong or control-character names', () => {
  expect(
    requestSchemas['room:join'].parse({
      code: ' abcdef ',
      displayName: '  Ａlice  ',
    }),
  ).toEqual({ code: 'ABCDEF', displayName: 'Alice' });
  for (const displayName of [
    '',
    ' '.repeat(30),
    'x'.repeat(25),
    'a\nb',
    'a\u200bb',
  ]) {
    expect(
      requestSchemas['room:create'].safeParse({ displayName, preset: 'small' })
        .success,
    ).toBe(false);
  }
  expect(
    requestSchemas['room:create'].safeParse({
      displayName: 'Valid',
      preset: 'gigantic',
    }).success,
  ).toBe(false);
});

it('rejects forged identities, timeout commands, missing versions, and malformed targets', () => {
  const envelope = {
    commandId: randomUUID(),
    matchId: randomUUID(),
    expectedVersion: 0,
  };
  for (const action of [
    { type: 'timeout' },
    { type: 'attack', cell: { x: -1, y: 0 } },
    { type: 'attack', cell: { x: 0.5, y: 0 } },
    { type: 'attack', cell: { x: 28, y: 0 } },
  ]) {
    expect(
      requestSchemas['action:submit'].safeParse({ ...envelope, action })
        .success,
    ).toBe(false);
  }
  expect(
    requestSchemas['turn:end'].safeParse({ ...envelope, actorId: randomUUID() })
      .success,
  ).toBe(false);
  expect(
    requestSchemas['turn:end'].safeParse({
      commandId: randomUUID(),
      matchId: randomUUID(),
    }).success,
  ).toBe(false);
  expect(
    requestSchemas['card:choose'].safeParse({
      ...envelope,
      cardId: 'survey',
      targets: { cell: { x: 0, y: 0, tower: 'secret' } },
    }).success,
  ).toBe(false);
});

it('does not accept arbitrary private state as a match view or arbitrary errors as acknowledgements', () => {
  expect(
    matchViewSchema.safeParse({ seed: 42, rngState: 7, towers: [] }).success,
  ).toBe(false);
  expect(
    ackSchema.safeParse({
      ok: false,
      code: 'DATABASE_FAILURE',
      message: 'private error',
    }).success,
  ).toBe(false);
  expect(
    ackSchema.safeParse({
      ok: false,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Retry.',
      stack: 'private',
    }).success,
  ).toBe(false);
});
