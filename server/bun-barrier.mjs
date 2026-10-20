import { afterAll } from "bun:test";

// Bun 1.4 can exit before its inspector flushes the last test event. This
// external root hook yields to its event loop until the collector acknowledges
// an ordered inspector barrier. No test declaration or project file is changed.
const token = process.env.UNIT_TEST_PULSE_BUN_BARRIER;
const pending = new Map();
let sequence = 0;
process.on("message", (message) => {
  if (message?.pulseBunBarrier !== token) return;
  const resolve = pending.get(message.id);
  if (resolve) {
    pending.delete(message.id);
    resolve();
  }
});
afterAll(
  () =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            "Unit Test Pulse did not acknowledge Bun's final inspector events.",
          ),
        );
      }, 10000);
      pending.set(id, () => {
        clearTimeout(timer);
        resolve();
      });
      process.send({ pulseBunBarrier: token, id });
    }),
  15000,
);
