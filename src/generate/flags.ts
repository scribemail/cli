/**
 * JSON Schema (from tools/list) → commander flags, and parsed flag values →
 * the tool's arguments object.
 *
 * Mapping rules:
 *   - snake_case property `foo_bar` → `--foo-bar`
 *   - string/number/integer → value flag (enum → choices)
 *   - boolean → paired `--x` / `--no-x`; ABSENT means the key is omitted
 *     entirely (PATCH semantics: omitted ≠ false)
 *   - array of scalars → repeatable value flag
 *   - objects / arrays of objects / mixed unions → JSON flag: inline JSON,
 *     `@file`, or `-` for stdin; the literal `null` clears (API semantics)
 *   - `--json` supplies the whole arguments object; explicit flags override
 */

import { readFileSync } from "node:fs";
import { InvalidArgumentError, Option } from "commander";

export interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  items?: JsonSchemaProperty;
  anyOf?: unknown[];
  [key: string]: unknown;
}

export interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

export type FlagKind = "string" | "number" | "boolean" | "array" | "json";

export interface FlagSpec {
  /** Original schema property (snake_case). */
  key: string;
  /** commander's camelCase opts key for --kebab-case. */
  optKey: string;
  flag: string;
  kind: FlagKind;
  description: string;
  enumValues?: string[];
  required: boolean;
  /** For arrays of numbers, coerce items. */
  numericItems?: boolean;
}

const kebab = (key: string) => key.replaceAll("_", "-");
const camel = (key: string) =>
  kebab(key).replace(/-([a-z0-9])/gi, (_, c: string) => c.toUpperCase());

function schemaType(prop: JsonSchemaProperty): string | undefined {
  if (typeof prop.type === "string") return prop.type;
  if (Array.isArray(prop.type)) {
    // zod .nullable() emits ["<type>", "null"] — the value type drives the flag.
    const nonNull = prop.type.filter((t) => t !== "null");
    if (nonNull.length === 1) return nonNull[0];
  }
  return undefined;
}

function kindFor(prop: JsonSchemaProperty): { kind: FlagKind; numericItems?: boolean } {
  const type = schemaType(prop);
  switch (type) {
    case "string":
      return { kind: "string" };
    case "number":
    case "integer":
      return { kind: "number" };
    case "boolean":
      return { kind: "boolean" };
    case "array": {
      const itemType = prop.items ? schemaType(prop.items) : undefined;
      if (itemType === "string") return { kind: "array" };
      if (itemType === "number" || itemType === "integer")
        return { kind: "array", numericItems: true };
      return { kind: "json" };
    }
    default:
      // objects, unions, unknown shapes — JSON escape hatch.
      return { kind: "json" };
  }
}

export function flagSpecsFromSchema(schema: JsonSchemaObject): FlagSpec[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([key, prop]) => {
    const { kind, numericItems } = kindFor(prop);
    const flagName = `--${kebab(key)}`;
    const flag =
      kind === "boolean"
        ? flagName
        : kind === "json"
          ? `${flagName} <json>`
          : `${flagName} <value>`;
    const enumValues =
      kind === "string" && Array.isArray(prop.enum) ? prop.enum.map(String) : undefined;
    let description = prop.description ?? "";
    if (kind === "json") description = `${description} (JSON; @file or - for stdin)`.trim();
    return {
      key,
      optKey: camel(key),
      flag,
      kind,
      description,
      enumValues,
      required: required.has(key),
      numericItems,
    };
  });
}

function parseNumber(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new InvalidArgumentError(`"${value}" is not a number.`);
  return n;
}

/** Resolve a JSON flag value: `-` → stdin, `@path` → file, else inline JSON. */
export function parseJsonValue(raw: string, readStdin: () => string): unknown {
  let text = raw;
  if (raw === "-") text = readStdin();
  else if (raw.startsWith("@")) {
    try {
      text = readFileSync(raw.slice(1), "utf8");
    } catch (err) {
      throw new InvalidArgumentError(`Could not read ${raw.slice(1)}: ${(err as Error).message}`);
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidArgumentError(`Invalid JSON: ${text.slice(0, 120)}`);
  }
}

/** Build commander Options for a spec (boolean kind yields the --x/--no-x pair). */
export function optionsForSpec(spec: FlagSpec, readStdin: () => string): Option[] {
  switch (spec.kind) {
    case "boolean": {
      const positive = new Option(spec.flag, spec.description);
      const negative = new Option(
        spec.flag.replace(/^--/, "--no-"),
        `Explicitly set ${spec.key} to false.`,
      );
      return [positive, negative];
    }
    case "number":
      return [new Option(spec.flag, spec.description).argParser(parseNumber)];
    case "array": {
      const parser = spec.numericItems
        ? (value: string, previous?: unknown[]) => [...(previous ?? []), parseNumber(value)]
        : (value: string, previous?: unknown[]) => [...(previous ?? []), value];
      return [new Option(spec.flag, `${spec.description} (repeatable)`).argParser(parser)];
    }
    case "json":
      return [
        new Option(spec.flag, spec.description).argParser((value: string) =>
          parseJsonValue(value, readStdin),
        ),
      ];
    default: {
      const option = new Option(spec.flag, spec.description);
      if (spec.enumValues) option.choices(spec.enumValues);
      return [option];
    }
  }
}

/**
 * Merge parsed flag values over an optional `--json` base object into the
 * tool-call arguments. Missing required keys become a usage error upstream
 * (NOT commander requiredOption — that would block the --json path).
 */
export function buildToolArgs(
  specs: FlagSpec[],
  opts: Record<string, unknown>,
  jsonBase: unknown,
): { args: Record<string, unknown>; missingRequired: string[] } {
  const args: Record<string, unknown> =
    jsonBase && typeof jsonBase === "object" && !Array.isArray(jsonBase)
      ? { ...(jsonBase as Record<string, unknown>) }
      : {};

  for (const spec of specs) {
    const value = opts[spec.optKey];
    if (value !== undefined) args[spec.key] = value;
  }

  const missingRequired = specs
    .filter((spec) => spec.required && args[spec.key] === undefined)
    .map((spec) => spec.flag.split(" ")[0]);

  return { args, missingRequired };
}
