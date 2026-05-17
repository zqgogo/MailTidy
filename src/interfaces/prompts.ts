/**
 * 终端交互提示：恢复扫描时的 [r]/[c]/[s]/[d] 输入由这里读。
 * 隔离 stdin 读取，让单测可以用 Mock 注入。
 */

import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";

export interface Prompter {
  ask(question: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * 终端提示器。
 * 用底层 readline + 手动队列 'line' / 'close' 事件，让 pipe 进来的 stdin
 * 也能正常读到行（`node:readline/promises` 的 `question()` 在 stdin EOF
 * 时会抢先报 ERR_USE_AFTER_CLOSE，吃掉最后一行输入）。
 */
export function createReadlinePrompter(): Prompter {
  const rl = readline.createInterface({ input, output });
  const buffered: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  let closed = false;

  rl.on("line", (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else buffered.push(line);
  });
  rl.on("close", () => {
    closed = true;
    while (waiters.length) {
      const waiter = waiters.shift();
      waiter?.("");
    }
  });

  return {
    async ask(question: string): Promise<string> {
      output.write(question);
      if (buffered.length) return buffered.shift()!;
      if (closed) return "";
      return new Promise<string>((resolve) => waiters.push(resolve));
    },
    async close(): Promise<void> {
      if (!closed) rl.close();
    },
  };
}
