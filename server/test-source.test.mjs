import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTestSource, readTestSource } from "./test-source.mjs";
const selected = (title, parents = [], location) => ({
  title,
  titlePath: [...parents, title],
  location,
});

test("extracts the complete nested TypeScript test without adjacent declarations", () => {
  const text = [
    "describe('cart', () => {",
    "  it('discount', async () => {",
    "    const pattern = /[{}]/g; // } and it('fake')",
    "    const value: string = `brace } ${1}`;",
    "    expect({ value }).toEqual({ value });",
    "  });",
    "  it('other', () => {});",
    "});",
  ].join("\n");
  const result = extractTestSource(
    "cart.spec.ts",
    text,
    selected("discount", ["cart"]),
  );
  assert.equal(result.startLine, 2);
  assert.equal(result.endLine, 6);
  assert.match(result.text, /^it\('discount'/);
  assert.match(result.text, /const pattern/);
  assert.match(result.text, /\n  const value/);
  assert.match(result.text, /\n}\)$/);
  assert.doesNotMatch(result.text, /it\('other'/);
});

test("full suite paths distinguish repeated titles and safely reject ambiguity", () => {
  const text =
    "describe('one',()=>{ test('same',()=>{}); });\ndescribe('two',()=>{ test('same',()=>{ expect(1).toBe(1) }); });";
  assert.match(
    extractTestSource("a.js", text, selected("same", ["two"])).text,
    /expect/,
  );
  const duplicate =
    "test('same',()=>{});\ntest('same',()=>{ expect(2).toBe(2) });";
  assert.throws(
    () => extractTestSource("a.js", duplicate, selected("same")),
    /Several/,
  );
  assert.match(
    extractTestSource(
      "a.js",
      duplicate,
      selected("same", [], { line: 2, column: 1 }),
    ).text,
    /expect/,
  );
  const sameLine =
    "test('same',()=>{}); test('same',()=>{ expect(3).toBe(3) });";
  assert.match(
    extractTestSource(
      "a.js",
      sameLine,
      selected("same", [], { line: 1, column: 22 }),
    ).text,
    /expect/,
  );
});

test("handles aliases, modifiers, JSX, CRLF, todo, and stale unique locations", () => {
  const text =
    "import {test as check, describe as group} from 'vitest';\r\ngroup('view', () => {\r\n  check.concurrent('renders', () => { expect(<div/>).toBeTruthy(); });\r\n  check.todo('later');\r\n});";
  assert.match(
    extractTestSource(
      "view.test.tsx",
      text,
      selected("renders", ["view"], { line: 1, column: 1 }),
    ).text,
    /<div\/>/,
  );
  assert.equal(
    extractTestSource("view.test.tsx", text, selected("later", ["view"])).text,
    "check.todo('later')",
  );
  assert.equal(
    extractTestSource(
      "a.mjs",
      "import * as v from 'vitest'; v.test.skip('x',()=>{});",
      selected("x"),
    ).text,
    "v.test.skip('x',()=>{})",
  );
});

test("runner locations identify parameterized and dynamic declarations", () => {
  const text =
    "test.each([1,2])('number %i', value => { expect(value).toBeTruthy(); });\ntest(`dynamic ${name}`, () => {});";
  assert.match(
    extractTestSource(
      "a.cjs",
      text,
      selected("number 2", [], { line: 1, column: 6 }),
    ).text,
    /^test.each/,
  );
  assert.match(
    extractTestSource(
      "a.ts",
      text,
      selected("dynamic abc", [], { line: 2, column: 1 }),
    ).text,
    /dynamic/,
  );
  assert.throws(
    () => extractTestSource("a.ts", text, selected("missing")),
    /could not be matched/,
  );
  assert.throws(
    () => extractTestSource("a.ts", "it('x',()=>{", selected("x")),
    /could not be parsed/,
  );
});

test("per-test source checks run membership and preserves workspace boundaries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pulse-test-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  await mkdir(project);
  const file = join(project, "a.test.ts");
  await writeFile(file, "it('x',()=>{});");
  const run = {
    projectRoot: project,
    files: [{ file }],
    tests: [{ id: "x", file, ...selected("x") }],
  };
  assert.equal(
    (await readTestSource(run, "x", project)).text,
    "it('x',()=>{})",
  );
  await assert.rejects(readTestSource(run, "unknown", project), /not part/);
  const outside = join(root, "private.ts");
  await writeFile(outside, "it('secret',()=>{});");
  const link = join(project, "escape.ts");
  await symlink(outside, link);
  run.files.push({ file: link });
  run.tests.push({ id: "escape", file: link, ...selected("secret") });
  await assert.rejects(readTestSource(run, "escape", project), /outside/);
});

test("Node imports, CommonJS aliases, and context subtests resolve individual declarations", () => {
  const cases = [
    [
      "import check, {describe as group, it as example} from 'node:test'; group('suite',()=>{example('child',()=>{});});",
      ["suite", "child"],
      "example('child'",
    ],
    [
      "const {it: example, describe: group} = require('node:test'); group('suite',()=>{example('child',()=>{});});",
      ["suite", "child"],
      "example('child'",
    ],
    [
      "const check = require('node:test'); check('parent',async context=>{await context.test('child',()=>{});});",
      ["parent", "child"],
      "context.test('child'",
    ],
    [
      "import check from 'node:test'; check('parent',async t=>{await t.test('child',()=>{});});",
      ["parent", "child"],
      "t.test('child'",
    ],
    [
      "import * as node from 'node:test'; node.describe('suite',()=>{node.it('child',()=>{});});",
      ["suite", "child"],
      "node.it('child'",
    ],
  ];
  for (const [text, titlePath, prefix] of cases) {
    const result = extractTestSource("example.test.mjs", text, {
      title: "child",
      titlePath,
    });
    assert.ok(result.text.startsWith(prefix), result.text);
    assert.doesNotMatch(result.text, /describe|group|check\('parent'/);
  }
});

test("Mocha BDD/TDD, context/specify, and module aliases select individual declarations", () => {
  for (const [text, title, parents, expression] of [
    [
      "import {describe as group,it as check} from 'mocha';group('suite',()=>check('case',()=>{}));",
      "case",
      ["suite"],
      "check",
    ],
    [
      "const {suite:group,test:check}=require('mocha');group('suite',()=>check('case',()=>{}));",
      "case",
      ["suite"],
      "check",
    ],
    [
      "import mocha from 'mocha';mocha.context('suite',()=>mocha.specify('case',()=>{}));",
      "case",
      ["suite"],
      "mocha.specify",
    ],
    [
      "const m=require('mocha');m.context('suite',()=>m.it.skip('case',()=>{}));",
      "case",
      ["suite"],
      "m.it.skip",
    ],
    [
      "context('suite',()=>{xspecify('case',()=>{});specify('other',()=>{});});",
      "case",
      ["suite"],
      "xspecify",
    ],
  ]) {
    const source = extractTestSource(
      "example.test.ts",
      text,
      selected(title, parents),
    );
    assert.ok(source.text.startsWith(expression + "("), source.text);
  }
});

test("Bun aliases and namespace imports retain per-test source previews", () => {
  for (const text of [
    "import {test as check,describe as group} from 'bun:test';group('suite',()=>check('case',()=>{}));",
    "const {test:check,describe:group}=require('bun:test');group('suite',()=>check('case',()=>{}));",
  ]) {
    assert.match(
      extractTestSource("example.test.ts", text, selected("case", ["suite"]))
        .text,
      /^check\('case'/,
    );
  }
  assert.match(
    extractTestSource(
      "example.test.ts",
      "import * as b from 'bun:test';b.test('case',()=>{});",
      selected("case"),
    ).text,
    /^b.test\('case'/,
  );
});

test("Jasmine globals, CommonJS aliases and default module namespace retain declarations", () => {
  for (const [source, titlePath, pattern] of [
    [
      "describe('group',()=>{fit('focused',()=>{});xit('skipped',()=>{})});",
      ["group", "focused"],
      /^fit\(/,
    ],
    [
      "const {describe:group,it:check}=require('jasmine-core');group('group',()=>check('selected',()=>{}));",
      ["group", "selected"],
      /^check\(/,
    ],
    [
      "import core from 'jasmine-core';core.describe('group',()=>core.it('selected',()=>{}));",
      ["group", "selected"],
      /^core\.it\(/,
    ],
  ]) {
    const result = extractTestSource("example.test.ts", source, {
      title: titlePath.at(-1),
      titlePath,
    });
    assert.match(result.text, pattern);
  }
});
