import { open, realpath } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { inside } from "./environment.mjs";
export async function readSource(run, file, workspace) {
  if (!run.files.some((item) => item.file === file))
    throw new Error("That file is not part of this run.");
  const root = await realpath(workspace),
    target = await realpath(resolve(run.projectRoot, file));
  if (!inside(root, await realpath(run.projectRoot)) || !inside(root, target))
    throw new Error("Source outside this workspace cannot be previewed.");
  if (
    ![".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"].includes(
      extname(target),
    )
  )
    throw new Error("Unsupported source file type.");
  const handle = await open(target, "r");
  try {
    if (!(await handle.stat()).isFile())
      throw new Error("Source must be a regular file.");
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    let length = 0;
    while (length < buffer.length) {
      const r = await handle.read(buffer, length, buffer.length - length, null);
      if (!r.bytesRead) break;
      length += r.bytesRead;
    }
    if (length > 1024 * 1024)
      throw new Error("Source exceeds the 1 MiB preview limit.");
    if (buffer.subarray(0, length).includes(0))
      throw new Error("Binary source cannot be previewed.");
    return { file, text: buffer.subarray(0, length).toString("utf8") };
  } finally {
    await handle.close();
  }
}
