import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { pathToFileURL } from "node:url";
import { readFile, readdir } from "node:fs/promises";
import {
  repairVitestTaskUpdates,
  repairVitestVmTaskUpdates,
} from "./vitest-progress.mjs";

// Upstream Vitest 4/5 throttle shapes, with the task-update marker that scopes
// the repair. Exercise timer behavior rather than checking replacement text.
function upstream(version) {
  return `function throttle(fn, ms) {
  let last = 0;
  let pendingCall;
  return function call(...args) {
    const now = unixNow();
    if (now - last > ms) {
      last = now;
      clearTimeout(pendingCall);
      pendingCall = ${version === 4 ? "undefined" : "void 0"};
      return fn.apply(this, args);
    }
    // Make sure fn is still called even if there are no further calls
    pendingCall ??= ${version === 4 ? "setTimeout(() => call.bind(this)(...args), ms)" : "setTimeout(call.bind(this), ms, ...args)"};
  };
}
// throttle based on summary reporter's DURATION_UPDATE_INTERVAL_MS
`;
}
const urls = {
  4: "file:///project/node_modules/@vitest/runner/dist/chunk-artifact.js",
  5: "file:///project/node_modules/vitest/dist/chunks/run.example.js",
};
function clock(source) {
  let now = 1000,
    sequence = 0;
  const timers = new Map(),
    calls = [];
  const throttle = runInNewContext(source + "\nthrottle", {
    unixNow: () => now,
    setTimeout(fn, delay, ...args) {
      const id = ++sequence;
      timers.set(id, { fn, delay, args });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  const update = throttle(function (...args) {
    calls.push({ owner: this, args });
  }, 100);
  return {
    update,
    calls,
    timers,
    at(value) {
      now = value;
    },
    fire() {
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.fn(...timer.args);
    },
  };
}
for (const version of [4, 5]) {
  test(`Vitest ${version}: exact deadline flushes once with the original receiver and arguments`, () => {
    const source = upstream(version);
    const broken = clock(source);
    broken.update();
    broken.at(1001);
    broken.update();
    broken.at(1100);
    broken.fire();
    assert.equal(
      broken.calls.length,
      1,
      "the unmodified upstream implementation reproduces the lost update",
    );
    assert.equal(broken.timers.size, 0);

    const repaired = repairVitestTaskUpdates(urls[version], source);
    assert.equal(repaired.split("\n").length, source.split("\n").length);
    const c = clock(repaired),
      owner = {};
    c.update.call(owner, "initial");
    c.at(1001);
    c.update.call(owner, "queued", 42);
    c.at(1100);
    c.fire();
    assert.equal(c.calls.length, 2);
    assert.equal(c.calls[1].owner, owner);
    assert.deepEqual([...c.calls[1].args], ["queued", 42]);
    assert.equal(c.timers.size, 0);
    c.at(1200);
    c.update("later");
    assert.equal(c.calls.length, 3);
    assert.equal(c.timers.size, 0);
    assert.equal(repairVitestTaskUpdates(urls[version], repaired), repaired);
  });
  test(`Vitest ${version}: early callbacks rearm and an immediate update cancels a pending timer`, () => {
    const c = clock(repairVitestTaskUpdates(urls[version], upstream(version)));
    c.update();
    c.at(1001);
    c.update("pending");
    assert.equal([...c.timers.values()][0].delay, 99);
    c.at(1099);
    c.fire();
    assert.equal(c.calls.length, 1);
    assert.equal(c.timers.size, 1);
    assert.equal([...c.timers.values()][0].delay, 1);
    c.at(1100);
    c.update("new update");
    assert.equal(c.calls.length, 2);
    assert.equal(c.timers.size, 0);
    c.at(1101);
    c.update();
    c.at(1200);
    c.fire();
    assert.equal(c.calls.length, 3);
    assert.equal(c.timers.size, 0);
  });
}
test("Vitest progress repair leaves unrelated and unknown implementations unchanged", () => {
  const source = upstream(5);
  for (const url of [
    "invalid",
    "file:///project/src/run.example.js",
    "file:///project/node_modules/other/dist/chunks/run.example.js",
  ])
    assert.equal(repairVitestTaskUpdates(url, source), source);
  for (const changed of [
    source.replace("last > ms", "last >= ms"),
    source.replace("let last = 0", "let last = unixNow()"),
    source.replace(
      "// throttle based on summary reporter's DURATION_UPDATE_INTERVAL_MS",
      "// different throttle",
    ),
  ])
    assert.equal(repairVitestTaskUpdates(urls[5], changed), changed);
});

test("Vitest VM text cache applies the same repair without changing unrelated text, buffers, or caching", async () => {
  const folder = new URL(
    "../node_modules/vitest/dist/chunks/",
    import.meta.url,
  );
  const file = (await readdir(folder)).find((name) =>
    /^vm\..*\.js$/.test(name),
  );
  const url = new URL(file, folder).href;
  const source = await readFile(new URL(url), "utf8");
  const repaired = repairVitestVmTaskUpdates(url, source);
  assert.notEqual(
    repaired,
    source,
    "the installed VM loader must be recognized",
  );
  assert.equal(repaired.split("\n").length, source.split("\n").length);
  const cacheClass = /class FileMap \{[\s\S]*?\n\}/.exec(repaired)[0];
  const sourceReads = [];
  const buffer = Buffer.from("original buffer");
  const text = upstream(5);
  const target = new URL(urls[5]).pathname;
  const map = runInNewContext(cacheClass + "; new FileMap()", {
    __pulseRepairVitestTaskUpdates: repairVitestTaskUpdates,
    pathToFileURL,
    promises: {
      readFile: async (path) => {
        sourceReads.push(path);
        return text;
      },
    },
    readFileSync(path, encoding) {
      sourceReads.push(path);
      return encoding ? text : buffer;
    },
  });
  const expected = repairVitestTaskUpdates(urls[5], text);
  assert.equal(map.readFile(target), expected);
  assert.equal(await map.readFileAsync(target), expected);
  assert.equal(
    sourceReads.length,
    1,
    "source remains cached across sync and async reads",
  );
  const secondTarget = target.replace("example", "other");
  assert.equal(await map.readFileAsync(secondTarget), expected);
  assert.equal(map.readFile(secondTarget), expected);
  assert.equal(sourceReads.length, 2);
  assert.equal(map.readFile("/project/application.js"), text);
  assert.equal(map.readBuffer(target), buffer);
  assert.equal(map.readBuffer(target), buffer);
  assert.equal(sourceReads.length, 4);
  assert.equal(
    repairVitestVmTaskUpdates("file:///project/vm.example.js", source),
    source,
  );
  assert.equal(
    repairVitestVmTaskUpdates(
      url,
      source.replace("fsCache =", "differentCache ="),
    ),
    source.replace("fsCache =", "differentCache ="),
  );
  assert.equal(repairVitestVmTaskUpdates(url, repaired), repaired);
});
