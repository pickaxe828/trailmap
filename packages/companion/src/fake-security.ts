import type { SecurityRunner } from './secrets';

/** Models the macOS CLI's line limit, including a successful exit after a truncated write. */
export function fakeSecurity({ lineLimit = 4096 } = {}) {
  const items = new Map<string, string>();
  const calls: Array<{ args: string[]; stdin?: string }> = [];
  const item = (args: string[]) => `${args[args.indexOf('-s') + 1]}/${args[args.indexOf('-a') + 1]}`;
  const run: SecurityRunner = async (args, stdin) => {
    calls.push({ args, stdin });
    if (args[0] === '-i') {
      const words = stdin!.slice(0, lineLimit).trim().split(' ');
      items.set(item(words), words[words.indexOf('-w') + 1]!);
      return { code: 0, stdout: '' };
    }
    if (args[0] === 'find-generic-password') {
      const v = items.get(item(args));
      return v === undefined ? { code: 44, stdout: '' } : { code: 0, stdout: `${v}\n` };
    }
    if (args[0] === 'delete-generic-password') {
      return items.delete(item(args)) ? { code: 0, stdout: '' } : { code: 44, stdout: '' };
    }
    throw new Error(`unexpected ${args[0]}`);
  };
  return { run, calls, items };
}
