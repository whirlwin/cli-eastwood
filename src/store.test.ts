import { expect, test } from "bun:test";
import { createStore } from "./store";
import { tempEnv } from "./test-util";

test("values persist across store instances, per extension", () => {
  const { paths } = tempEnv();
  createStore(paths.state, "a").set("n", { x: 1 });
  expect(createStore(paths.state, "a").get("n")).toEqual({ x: 1 });
  expect(createStore(paths.state, "b").get("n")).toBeUndefined();
});

test("delete removes a key and a missing file reads as empty", () => {
  const { paths } = tempEnv();
  const store = createStore(paths.state, "a");
  expect(store.get("k")).toBeUndefined();
  store.set("k", 1);
  store.delete("k");
  expect(store.get("k")).toBeUndefined();
});
