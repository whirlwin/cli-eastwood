import { expect, test } from "bun:test";
import type { FlagSpec } from "./api";
import { UsageError } from "./errors";
import { parseFlags } from "./flags";

const specs: Record<string, FlagSpec> = {
  name: { type: "string", short: "n" },
  count: { type: "number", default: 1 },
  loud: { type: "boolean", short: "l" },
  color: { type: "boolean", default: true },
};

test("--name value, --name=value and -s short", () => {
  expect(parseFlags(["--name", "a"], specs).flags.name).toBe("a");
  expect(parseFlags(["--name=b"], specs).flags.name).toBe("b");
  expect(parseFlags(["-n", "c"], specs).flags.name).toBe("c");
  expect(parseFlags(["-n=d"], specs).flags.name).toBe("d");
});

test("booleans, --no-x and explicit values", () => {
  expect(parseFlags(["--loud"], specs).flags.loud).toBe(true);
  expect(parseFlags(["-l"], specs).flags.loud).toBe(true);
  expect(parseFlags(["--no-color"], specs).flags.color).toBe(false);
  expect(parseFlags(["--loud=false"], specs).flags.loud).toBe(false);
});

test("numbers are coerced and defaults applied", () => {
  expect(parseFlags([], specs).flags).toEqual({ count: 1, color: true });
  expect(parseFlags(["--count", "-5"], specs).flags.count).toBe(-5);
  expect(() => parseFlags(["--count", "x"], specs)).toThrow(UsageError);
});

test("positionals, negative numbers and -- stop parsing", () => {
  const parsed = parseFlags(["a", "-5", "--loud", "--", "--name", "b"], specs);
  expect(parsed.args).toEqual(["a", "-5", "--name", "b"]);
  expect(parsed.flags.loud).toBe(true);
  expect(parsed.flags.name).toBeUndefined();
});

test("unknown flags and missing values are usage errors", () => {
  expect(() => parseFlags(["--nope"], specs)).toThrow("unknown flag --nope");
  expect(() => parseFlags(["-x"], specs)).toThrow("unknown flag -x");
  expect(() => parseFlags(["--name"], specs)).toThrow("needs a value");
  expect(() => parseFlags(["--constructor"], specs)).toThrow(UsageError);
});

test("a string flag consumes -h and --help as its value; bare ones show help", () => {
  const wanted = parseFlags(["--name", "-h"], specs);
  expect(wanted.flags.name).toBe("-h");
  expect(wanted.help).toBe(false);
  expect(parseFlags(["-n", "--help"], specs).help).toBe(false);
  expect(parseFlags(["--loud", "-h"], specs).help).toBe(true);
  expect(parseFlags(["--help"], specs).help).toBe(true);
  expect(parseFlags(["--", "-h"], specs).help).toBe(false);
});
