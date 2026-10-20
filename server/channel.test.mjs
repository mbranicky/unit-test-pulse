import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

test(
  "flushing IPC preserves queued large Unicode results before disconnect",
  { timeout: 10000 },
  async (t) => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import send from ${JSON.stringify(new URL("./channel.cjs", import.meta.url).href)};
    await send.flush();
    for(let id=0;id<8;id++)send({type:'test',id,text:'💙'.repeat(80000)});
    await send.flush();
    process.disconnect();
  `,
      ],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    t.after(() => child.kill());
    const received = [];
    let errors = "";
    child.on("message", (message) => received.push(message.event));
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    assert.equal(code, 0, errors);
    assert.equal(received.length, 8);
    assert.deepEqual(
      received.map((e) => e.id),
      [0, 1, 2, 3, 4, 5, 6, 7],
    );
    assert.ok(received.every((e) => e.text === "💙".repeat(80000)));
  },
);
