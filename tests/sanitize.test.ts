import { describe, expect, it } from "vitest";
import { sanitizeSensitive, sanitizeUnknown, truncate } from "../src/runtime/sanitize.js";

describe("runtime sanitization", () => {
  it("redacts common secrets and connection passwords", () => {
    const value = sanitizeSensitive("api_key=sk-12345678901234567890 password=hunter2 postgres://alice:pw123@db.test/app Bearer token-123456789");
    expect(value).toContain("[REDACTED_SECRET]");
    expect(value).not.toContain("hunter2");
    expect(value).not.toContain("pw123");
  });

  it("bounds strings, arrays, objects, and recursive input", () => {
    expect(truncate("abcd", 3)).toBe("ab…");
    expect(sanitizeUnknown(Array.from({ length: 33 }, () => "x"))).toHaveLength(32);
    expect(sanitizeUnknown(Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key${index}`, index])))).toHaveProperty("key63");
    expect(sanitizeUnknown({ one: { two: { three: { four: { five: { six: "value" } } } } } })).toEqual({ one: { two: { three: { four: { five: "[TRUNCATED]" } } } } });
  });
});
