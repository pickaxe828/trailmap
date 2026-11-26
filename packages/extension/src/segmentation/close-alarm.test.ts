import { expect, test } from 'bun:test';
import { CLOSE_ALARM, scheduleExpeditionClose } from './close-alarm';

test('one close alarm follows the earlier of the Expedition and computer-idle deadlines', async () => {
  const alarms = new Map<string, { scheduledTime: number }>();
  const clock = {
    get: async (name: string) => alarms.get(name),
    create: async (name: string, { when }: { when: number }) => { alarms.set(name, { scheduledTime: when }); },
    clear: async (name: string) => alarms.delete(name),
  };
  await scheduleExpeditionClose(clock, 2_000, 3_000);
  expect([...alarms]).toEqual([[CLOSE_ALARM, { scheduledTime: 2_000 }]]);
  await scheduleExpeditionClose(clock, 6_000, 3_000);
  expect([...alarms]).toEqual([[CLOSE_ALARM, { scheduledTime: 3_000 }]]);
  await scheduleExpeditionClose(clock, null, null);
  expect([...alarms]).toEqual([]);
});
