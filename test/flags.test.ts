import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildToolArgs,
  flagSpecsFromSchema,
  parseJsonValue,
  type JsonSchemaObject,
} from "../src/generate/flags.js";

const SCHEMA: JsonSchemaObject = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", description: "The name." },
    content: { type: "string", enum: ["draft", "published"] },
    priority: { type: "integer" },
    activated: { type: "boolean" },
    email_ids: { type: "array", items: { type: "string" } },
    draft_content: { type: ["object", "null"], description: "Block tree." },
    conditions: { anyOf: [{ type: "object" }, { type: "null" }] },
  },
};

describe("flagSpecsFromSchema", () => {
  const specs = flagSpecsFromSchema(SCHEMA);
  const byKey = Object.fromEntries(specs.map((s) => [s.key, s]));

  it("maps snake_case to kebab flags with camel opt keys", () => {
    expect(byKey.email_ids.flag).toBe("--email-ids <value>");
    expect(byKey.email_ids.optKey).toBe("emailIds");
    expect(byKey.draft_content.optKey).toBe("draftContent");
  });

  it("classifies kinds: scalars, enum, boolean, arrays, JSON trees", () => {
    expect(byKey.name.kind).toBe("string");
    expect(byKey.content.enumValues).toEqual(["draft", "published"]);
    expect(byKey.priority.kind).toBe("number");
    expect(byKey.activated.kind).toBe("boolean");
    expect(byKey.email_ids.kind).toBe("array");
    expect(byKey.draft_content.kind).toBe("json");
    expect(byKey.conditions.kind).toBe("json");
  });

  it("tracks requiredness from the schema", () => {
    expect(byKey.name.required).toBe(true);
    expect(byKey.priority.required).toBe(false);
  });
});

describe("parseJsonValue", () => {
  it("parses inline JSON including the literal null", () => {
    expect(parseJsonValue('{"a":1}', () => "")).toEqual({ a: 1 });
    expect(parseJsonValue("null", () => "")).toBeNull();
  });

  it("reads @file and - (stdin)", () => {
    const dir = mkdtempSync(join(tmpdir(), "scribe-flags-"));
    const file = join(dir, "tree.json");
    writeFileSync(file, '{"type":"stack"}');
    expect(parseJsonValue(`@${file}`, () => "")).toEqual({ type: "stack" });
    expect(parseJsonValue("-", () => '{"from":"stdin"}')).toEqual({ from: "stdin" });
  });

  it("rejects invalid JSON and unreadable files with usage errors", () => {
    expect(() => parseJsonValue("{oops", () => "")).toThrow(/Invalid JSON/);
    expect(() => parseJsonValue("@/nonexistent/path.json", () => "")).toThrow(/Could not read/);
  });
});

describe("buildToolArgs", () => {
  const specs = flagSpecsFromSchema(SCHEMA);

  it("merges flags over a --json base (flags win)", () => {
    const { args } = buildToolArgs(
      specs,
      { name: "CLI name", priority: 2 },
      { name: "json name", activated: true },
    );
    expect(args).toEqual({ name: "CLI name", priority: 2, activated: true });
  });

  it("omits absent booleans entirely (PATCH semantics)", () => {
    const { args } = buildToolArgs(specs, { name: "x" }, undefined);
    expect("activated" in args).toBe(false);
  });

  it("reports missing required keys instead of silently proceeding", () => {
    const { missingRequired } = buildToolArgs(specs, {}, undefined);
    expect(missingRequired).toEqual(["--name"]);
    const viaJson = buildToolArgs(specs, {}, { name: "from json" });
    expect(viaJson.missingRequired).toEqual([]);
  });
});
