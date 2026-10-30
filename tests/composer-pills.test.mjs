import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(
  readFileSync(new URL("../client/composer-pills.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function setup(t, options = {}) {
  const other = { plugin: "progress" };
  const surface = [other],
    registrations = [],
    timers = new Map(),
    opened = [];
  let timerId = 0;
  const state = {
    agents: [{ id: "agent-1", workspaceId: "workspace-1" }],
    briefs: {
      "workspace-1": { status: "running", running: 1, label: "Unit tests 2/6" },
    },
    ...options,
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    Date,
    require(name) {
      assert.equal(name, "../shared/rpc");
      return { briefs: "briefs" };
    },
    setTimeout(fn, delay) {
      assert.equal(delay, 5000);
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  const client = {
    paseo: {
      workspaces: {
        async list() {
          return {
            entries: [{ id: "workspace-1" }, { id: "workspace-2" }],
            pageInfo: { hasMore: false },
          };
        },
      },
      agents: {
        async list(input) {
          assert.equal(input.filter.includeArchived, false);
          const offset = input.page.cursor ? Number(input.page.cursor) : 0;
          const limit = state.pageSize ?? 100;
          const next = offset + limit;
          return {
            entries: state.agents
              .slice(offset, next)
              .map((agent) => ({ agent })),
            pageInfo: {
              hasMore: next < state.agents.length,
              nextCursor: String(next),
            },
          };
        },
      },
    },
    async rpc(_contract, { workspaceIds }) {
      if (state.pending) await state.pending;
      if (state.failRpc) throw Error("disconnected");
      const id = workspaceIds[0];
      return { workspaces: state.briefs[id] ? { [id]: state.briefs[id] } : {} };
    },
    addHeaderButton() {
      assert.fail("Must not contribute a toolbar button");
    },
    addComposerPill(contribution) {
      const item = {
        ...contribution,
        button: { ...contribution.button },
        removed: false,
      };
      registrations.push(item);
      surface.push(item);
      return {
        update(patch) {
          assert.equal(item.removed, false);
          Object.assign(item.button, patch);
        },
        remove() {
          item.removed = true;
          const index = surface.indexOf(item);
          if (index !== -1) surface.splice(index, 1);
        },
      };
    },
    openPanel(id, options) {
      opened.push({ id, ...options });
    },
  };
  const stop = module.exports.watchComposerPills(client);
  t.after(stop);
  await flush();
  return {
    state,
    surface,
    registrations,
    other,
    opened,
    stop,
    timers,
    async poll() {
      const [id, callback] = timers.entries().next().value;
      timers.delete(id);
      callback();
      await flush();
    },
  };
}

test("composer pill follows other plugins, uses a static icon, and opens its workspace panel", async (t) => {
  const h = await setup(t);
  assert.equal(h.surface[0], h.other);
  const pill = h.surface[1];
  assert.equal(pill.agentId, "agent-1");
  assert.equal(pill.button.icon, "Activity");
  assert.equal(pill.button.label, "Unit tests 2/6");
  pill.button.behavior.onPress();
  assert.deepEqual(
    h.opened.map((x) => ({ ...x })),
    [{ id: "pulse", workspaceId: "workspace-1", location: "explorer" }],
  );
  h.state.briefs["workspace-1"] = {
    running: 0,
    status: "failed",
    label: "1 failed",
  };
  await h.poll();
  assert.equal(h.registrations.length, 1);
  assert.equal(h.surface[1], pill);
  assert.equal(pill.button.icon, "CircleX");
  assert.equal(pill.button.label, "1 failed");
  h.state.briefs["workspace-1"] = {
    running: 0,
    status: "passed",
    label: "6 passed",
  };
  await h.poll();
  assert.equal(pill.button.icon, "CircleCheck");
  assert.equal(h.surface[0], h.other);
});

test("every agent page gets its own pill; new agents join without re-registering existing pills", async (t) => {
  const h = await setup(t, {
    pageSize: 1,
    agents: [
      { id: "a", workspaceId: "workspace-1" },
      { id: "b", workspaceId: "workspace-1" },
    ],
  });
  assert.deepEqual(
    h.registrations.map((p) => p.agentId),
    ["a", "b"],
  );
  h.state.agents.push({ id: "c", workspaceId: "workspace-1" });
  await h.poll();
  assert.deepEqual(
    h.registrations.map((p) => p.agentId),
    ["a", "b", "c"],
  );
});

test("agent moves and removals release only their own registrations", async (t) => {
  const h = await setup(t);
  const original = h.surface[1];
  h.state.briefs["workspace-2"] = {
    running: 0,
    status: "passed",
    label: "4 passed",
  };
  h.state.agents[0].workspaceId = "workspace-2";
  await h.poll();
  assert.equal(original.removed, true);
  assert.equal(h.surface[1].workspaceId, "workspace-2");
  h.surface[1].button.behavior.onPress();
  assert.equal(h.opened[0].workspaceId, "workspace-2");
  h.state.agents = [];
  await h.poll();
  assert.deepEqual(h.surface, [h.other]);
});

test("no result removes the pill; transient RPC failures retry without duplicating it", async (t) => {
  const h = await setup(t);
  const original = h.surface[1];
  h.state.failRpc = true;
  await h.poll();
  assert.equal(h.surface[1], original);
  h.state.failRpc = false;
  delete h.state.briefs["workspace-1"];
  await h.poll();
  assert.deepEqual(h.surface, [h.other]);
});

test("cleanup clears the poll and removes only this plugin's pills", async (t) => {
  const h = await setup(t);
  h.stop();
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.surface, [h.other]);
});

test("cleanup during an in-flight result prevents late registrations and timers", async (t) => {
  let resolve;
  const h = await setup(t, {
    pending: new Promise((done) => {
      resolve = done;
    }),
  });
  h.stop();
  resolve();
  await flush();
  assert.equal(h.registrations.length, 0);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.surface, [h.other]);
});
