import { createRequire } from "node:module";
import { join } from "node:path";

// Paseo bundles server modules as ESM. Load the compiler from the installed
// plugin so its CommonJS filesystem globals retain their native Node context.
const loadParser = (directory) =>
  createRequire(directory ? join(directory, "package.json") : import.meta.url)(
    "typescript",
  );
import { readSource } from "./source.mjs";

/** Parse declarations only. Never import or execute the monitored source. */
export function extractTestSource(file, text, test, ts = loadParser()) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length)
    throw new Error(
      "The current file could not be parsed. Open the full file instead.",
    );
  const tests = new Set(["it", "test", "fit", "xit", "xtest"]);
  const suites = new Set(["describe", "fdescribe", "xdescribe", "suite"]);
  const namespaces = new Set();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !["vitest", "@jest/globals", "node:test"].includes(
        statement.moduleSpecifier.text,
      )
    )
      continue;
    if (
      statement.moduleSpecifier.text === "node:test" &&
      statement.importClause?.name
    ) {
      tests.add(statement.importClause.name.text);
      namespaces.add(statement.importClause.name.text);
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings))
      namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings))
      for (const item of bindings.elements) {
        const name = (item.propertyName || item.name).text;
        if (tests.has(name)) tests.add(item.name.text);
        if (suites.has(name)) suites.add(item.name.text);
      }
  }
  // CommonJS Node tests often alias the test function or destructure it().
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (
        !call ||
        !ts.isCallExpression(call) ||
        !ts.isIdentifier(call.expression) ||
        call.expression.text !== "require" ||
        call.arguments[0]?.text !== "node:test"
      )
        continue;
      if (ts.isIdentifier(declaration.name)) {
        tests.add(declaration.name.text);
        namespaces.add(declaration.name.text);
      } else if (ts.isObjectBindingPattern(declaration.name)) {
        for (const item of declaration.name.elements) {
          if (!ts.isIdentifier(item.name)) continue;
          const name = (item.propertyName || item.name).text;
          if (tests.has(name)) tests.add(item.name.text);
          if (suites.has(name)) suites.add(item.name.text);
        }
      }
    }
  }
  function root(expression, contexts = new Set()) {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) {
      if (
        ts.isIdentifier(expression.expression) &&
        contexts.has(expression.expression.text) &&
        expression.name.text === "test"
      )
        return "test";
      if (
        ts.isIdentifier(expression.expression) &&
        namespaces.has(expression.expression.text)
      )
        return expression.name.text;
      return root(expression.expression, contexts);
    }
    if (ts.isCallExpression(expression))
      return root(expression.expression, contexts);
    if (ts.isTaggedTemplateExpression(expression))
      return root(expression.tag, contexts);
    return null;
  }
  const title = (node) =>
    node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      ? node.text
      : null;
  const candidates = [];
  function visit(node, parents = [], contexts = new Set()) {
    if (ts.isCallExpression(node)) {
      const name = root(node.expression, contexts);
      const label = title(node.arguments[0]);
      const callback = node.arguments.find(
        (arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg),
      );
      // Ignore factory calls such as test.each(data) and test.extend(fixtures).
      const registration = label !== null || callback;
      if (registration && suites.has(name) && callback) {
        visit(callback.body, [...parents, label], contexts);
        return;
      }
      if (registration && tests.has(name)) {
        const start = node.getStart(source),
          end = node.getEnd();
        candidates.push({ node, start, end, titles: [...parents, label] });
        if (callback) {
          const nested = new Set(contexts);
          const parameter = callback.parameters[0]?.name;
          if (parameter && ts.isIdentifier(parameter))
            nested.add(parameter.text);
          visit(callback.body, [...parents, label], nested);
        }
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, parents, contexts));
  }
  visit(source);
  const path = test.titlePath || [test.title];
  const exact = candidates.filter(
    (item) =>
      item.titles.length === path.length &&
      item.titles.every((name, i) => name === path[i]),
  );
  const location = test.location;
  let selected;
  if (
    location &&
    Number.isInteger(location.line) &&
    location.line > 0 &&
    location.line <= source.getLineStarts().length
  ) {
    // Runners may point at the call or its callback. Require the declaration's
    // starting line to avoid selecting an unrelated test inside a broad range.
    const located = candidates.filter(
      (item) =>
        source.getLineAndCharacterOfPosition(item.start).line + 1 ===
        location.line,
    );
    const compatible = located.filter(
      (item) =>
        exact.includes(item) ||
        item.titles.some((name) => name === null) ||
        /\.each\b/.test(item.node.expression.getText(source)),
    );
    if (compatible.length === 1) selected = compatible[0];
    else if (compatible.length > 1) {
      const column = Math.max(0, (location.column || 1) - 1);
      const containing = compatible.filter((item) => {
        const start = source.getLineAndCharacterOfPosition(item.start);
        const end = source.getLineAndCharacterOfPosition(item.end);
        return (
          column >= start.character &&
          (end.line > start.line || column <= end.character)
        );
      });
      if (containing.length === 1) selected = containing[0];
    }
  }
  if (!selected && exact.length === 1) selected = exact[0];
  if (!selected)
    throw new Error(
      exact.length > 1
        ? "Several declarations have this title and no unique source location is available. Open the full file instead."
        : "The test declaration could not be matched in the current file. It may have changed or been generated by a helper. Open the full file instead.",
    );
  const start = source.getLineAndCharacterOfPosition(selected.start);
  const end = source.getLineAndCharacterOfPosition(selected.end);
  const prefix = text.slice(source.getLineStarts()[start.line], selected.start);
  const indent = /^\s*$/.test(prefix) ? prefix.length : 0;
  const snippet = text
    .slice(selected.start, selected.end)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line, i) =>
      i ? line.replace(new RegExp(`^[ \\t]{0,${indent}}`), "") : line,
    )
    .join("\n");
  return {
    file,
    text: snippet,
    startLine: start.line + 1,
    endLine: end.line + 1,
  };
}

export async function readTestSource(run, testId, workspace, pluginDirectory) {
  const test = run.tests.find((item) => item.id === testId);
  if (!test) throw new Error("This test is not part of the selected run.");
  const source = await readSource(run, test.file, workspace);
  return extractTestSource(
    source.file,
    source.text,
    test,
    loadParser(pluginDirectory),
  );
}
