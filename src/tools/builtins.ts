import { ToolCapabilityRegistry } from "./registry.js";
import type { ToolCapability } from "./types.js";

interface EchoInput {
  text: string;
  maxLength?: number;
}

interface AddInput {
  values: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const echoCapability: ToolCapability<
  EchoInput,
  { text: string; truncated: boolean }
> = {
  id: "utility.echo",
  description: "Return bounded text without external side effects.",
  actionClass: "propose",
  external: false,
  validate(input: unknown): EchoInput {
    if (!isRecord(input) || typeof input.text !== "string") {
      throw new Error("utility.echo requires { text: string, maxLength?: number }.");
    }

    if (
      input.maxLength !== undefined &&
      (typeof input.maxLength !== "number" ||
        !Number.isInteger(input.maxLength) ||
        input.maxLength < 1 ||
        input.maxLength > 10_000)
    ) {
      throw new Error("utility.echo maxLength must be an integer from 1 to 10000.");
    }

    return {
      text: input.text,
      ...(input.maxLength === undefined ? {} : { maxLength: input.maxLength }),
    };
  },
  async execute(input) {
    const maxLength = input.maxLength ?? 1_000;
    const text = input.text.slice(0, maxLength);
    return {
      text,
      truncated: text.length !== input.text.length,
    };
  },
};

export const addCapability: ToolCapability<AddInput, { total: number }> = {
  id: "math.add",
  description: "Add a bounded list of finite numbers.",
  actionClass: "read",
  external: false,
  validate(input: unknown): AddInput {
    if (
      !isRecord(input) ||
      !Array.isArray(input.values) ||
      input.values.length === 0 ||
      input.values.length > 100 ||
      input.values.some(
        (value) => typeof value !== "number" || !Number.isFinite(value),
      )
    ) {
      throw new Error("math.add requires { values: finite number[1..100] }.");
    }

    return { values: [...input.values] as number[] };
  },
  async execute(input) {
    return {
      total: input.values.reduce((sum, value) => sum + value, 0),
    };
  },
};

export function createBuiltinToolRegistry(): ToolCapabilityRegistry {
  return new ToolCapabilityRegistry()
    .register(echoCapability)
    .register(addCapability);
}
