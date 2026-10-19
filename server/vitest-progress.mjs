// Vitest 4.1/5.0's task-update throttle can lose its trailing call when a
// timer fires exactly at (or just before) 100 ms. Recognize only that known
// implementation, and leave other versions and application modules untouched.
export function repairVitestTaskUpdates(url, source) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return source;
  }
  if (
    !/\/(?:vitest\/dist\/chunks\/run\.[^/]+|@vitest\/runner\/dist\/[^/]+)\.js$/.test(
      pathname,
    )
  )
    return source;
  const match =
    /function throttle\(fn, ms\) \{[\s\S]*?\n\}\n(?=\/\/ throttle based on summary reporter's DURATION_UPDATE_INTERVAL_MS)/.exec(
      source,
    );
  if (!match) return source;
  const compact = match[0]
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\s+/g, "")
    .replace(/undefined/g, "void0");
  const expected =
    "functionthrottle(fn,ms){letlast=0;letpendingCall;returnfunctioncall(...args){constnow=unixNow();if(now-last>ms){last=now;clearTimeout(pendingCall);pendingCall=void0;returnfn.apply(this,args);}pendingCall??=setTimeout(call.bind(this),ms,...args);};}";
  const previous = expected.replace(
    "setTimeout(call.bind(this),ms,...args)",
    "setTimeout(()=>call.bind(this)(...args),ms)",
  );
  if (compact !== expected && compact !== previous) return source;
  const repaired = match[0]
    .replace(/now\s*-\s*last\s*>\s*ms/, "now - last >= ms")
    .replace(
      /pendingCall\s*\?\?=\s*setTimeout\([^;]+;/,
      "pendingCall ??= setTimeout(() => { pendingCall = undefined; call.apply(this, args); }, Math.max(1, ms - (now - last)));",
    );
  return (
    source.slice(0, match.index) +
    repaired +
    source.slice(match.index + match[0].length)
  );
}

// VM pools load external modules through Vitest's private text cache rather
// than Node's module loader. Bridge only its recognized cache implementation
// into the same narrow runner repair; never replace filesystem functions.
export function repairVitestVmTaskUpdates(url, source) {
  if (!/^file:.*\/vitest\/dist\/chunks\/vm\.[^/]+\.js$/.test(url))
    return source;
  const match = /class FileMap \{[\s\S]*?\n\}/.exec(source);
  if (!match) return source;
  const compact = match[0].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");
  const expected =
    'classFileMap{fsCache=newMap();fsBufferCache=newMap();asyncreadFileAsync(path){constcached=this.fsCache.get(path);if(cached!=null)returncached;constsource=awaitpromises.readFile(path,"utf-8");this.fsCache.set(path,source);returnsource;}readFile(path){constcached=this.fsCache.get(path);if(cached!=null)returncached;constsource=readFileSync(path,"utf-8");this.fsCache.set(path,source);returnsource;}readBuffer(path){constcached=this.fsBufferCache.get(path);if(cached!=null)returncached;constbuffer=readFileSync(path);this.fsBufferCache.set(path,buffer);returnbuffer;}}';
  if (
    compact !== expected ||
    !source.includes("{ fileURLToPath, pathToFileURL } from 'node:url'")
  )
    return source;
  const bridge = match[0].replace(
    /const source = (await promises\.readFile\(path, "utf-8"\)|readFileSync\(path, "utf-8"\));/g,
    "const source = __pulseRepairVitestTaskUpdates(pathToFileURL(path).href, $1);",
  );
  const dependency = new URL("./vitest-progress.mjs", import.meta.url).href;
  return (
    `import { repairVitestTaskUpdates as __pulseRepairVitestTaskUpdates } from ${JSON.stringify(dependency)};` +
    source.slice(0, match.index) +
    bridge +
    source.slice(match.index + match[0].length)
  );
}
