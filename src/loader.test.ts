import { expect, test } from "bun:test";
import { loadAll } from "./loader";
import { capture, tempEnv, writeExtension } from "./test-util";

const good = (name: string) => `export default { name: "${name}", commands: [{ name: "${name}" }] };`;

test("a broken extension is skipped, recorded and does not stop the others", async () => {
  const { paths } = tempEnv();
  writeExtension(paths, "a-good.ts", good("a"));
  writeExtension(paths, "b-throws.ts", `throw new Error("boom");`);
  writeExtension(paths, "c-syntax.ts", `export default {{{`);
  writeExtension(paths, "d-invalid.ts", `export default { nope: true };`);
  writeExtension(paths, "e-good.ts", good("e"));
  const { result, err } = await capture(() => loadAll(paths));
  expect(result.extensions.map((e) => e.extension.name)).toEqual(["a", "e"]);
  expect(result.errors.map((e) => e.source.split("/").pop())).toEqual(["b-throws.ts", "c-syntax.ts", "d-invalid.ts"]);
  expect(result.errors[0].message).toContain("boom");
  expect(err.split("\n")).toHaveLength(3);
  expect(err).toContain("clewd ext doctor");
});

test("config.ts inline extensions load first and disabled names are skipped", async () => {
  const { paths } = tempEnv();
  writeExtension(paths, "x.ts", good("x"));
  writeExtension(paths, "y.ts", good("y"));
  await Bun.write(
    `${paths.config}/config.ts`,
    `export default { disabled: ["y", "inline-off"], extensions: [{ name: "inline" }, { name: "inline-off" }] };`,
  );
  const { result } = await capture(() => loadAll(paths));
  expect(result.extensions.map((e) => e.extension.name)).toEqual(["inline", "x"]);
  expect(result.errors).toEqual([]);
});

test("a broken config.ts is recorded and extensions still load", async () => {
  const { paths } = tempEnv();
  writeExtension(paths, "x.ts", good("x"));
  await Bun.write(`${paths.config}/config.ts`, `export default 5;`);
  const { result } = await capture(() => loadAll(paths));
  expect(result.errors).toHaveLength(1);
  expect(result.extensions).toHaveLength(1);
});

test("a missing config dir loads nothing without errors", async () => {
  const { result } = await capture(() => loadAll(tempEnv().paths));
  expect(result.extensions).toEqual([]);
  expect(result.errors).toEqual([]);
});

test("CLEWD_NO_EXTENSIONS=1 loads no config.ts and no extensions", async () => {
  const { paths } = tempEnv();
  writeExtension(paths, "x.ts", good("x"));
  await Bun.write(`${paths.config}/config.ts`, `export default { custom: 1 };`);
  process.env.CLEWD_NO_EXTENSIONS = "1";
  try {
    const { result } = await capture(() => loadAll(paths));
    expect(result).toEqual({ config: {}, extensions: [], errors: [] });
  } finally {
    delete process.env.CLEWD_NO_EXTENSIONS;
  }
});
