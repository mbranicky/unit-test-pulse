// All reporter events pass through the runner's main process. Console output can
// be dropped under backpressure; results are never dropped to make room for logs.
let pendingBytes = 0;
let warned = false;
const waiters = [];
function delivered(bytes) {
  pendingBytes -= bytes;
  if (!pendingBytes) for (const resolve of waiters.splice(0)) resolve();
}
function deliver(event) {
  if (!process.connected) return;
  const message = { pulse: true, event };
  const bytes = Buffer.byteLength(JSON.stringify(message));
  if (event.type === "log" && pendingBytes + bytes > 2 * 1024 * 1024) {
    if (!warned) {
      warned = true;
      deliver({
        type: "notice",
        message:
          "Console capture was throttled because the collector could not keep up. Some console records were omitted; process output is a separate capture.",
      });
    }
    return;
  }
  pendingBytes += bytes;
  try {
    process.send(message, (error) => {
      delivered(bytes);
    });
  } catch {
    delivered(bytes);
  }
}
module.exports = (event) => {
  if (event.type === "start") warned = false;
  if (event.type === "log") {
    const original = String(event.record.text || "");
    if (Buffer.byteLength(original) > 256 * 1024) {
      event = {
        ...event,
        record: {
          ...event.record,
          text: Buffer.from(original)
            .subarray(0, 256 * 1024)
            .toString("utf8"),
          truncated: true,
        },
      };
      deliver({
        type: "notice",
        message:
          "A console record exceeded 256 KiB and was truncated before collection.",
      });
    }
  }
  deliver(event);
};

// Disconnecting Node IPC can discard queued large messages. Wait for every
// send callback before closing the worker's channel, including signal exits.
module.exports.flush = () =>
  pendingBytes === 0
    ? Promise.resolve()
    : new Promise((resolve) => waiters.push(resolve));
