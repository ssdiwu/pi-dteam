/**
 * P0/signalEvent 单元测试
 *
 * 覆盖：computeExpiresAt 边界、isExpired 边界、SignalEvent 字段构造
 */

import { describe, it, expect } from "vitest";
import {
  computeExpiresAt,
  isExpired,
  type SignalEvent,
} from "../../src/P0/signalEvent.js";

describe("P0/signalEvent", () => {
  describe("computeExpiresAt", () => {
    it("ttl 未设时返回 undefined（永不过期）", () => {
      const event = {
        type: "progress" as const,
        src: "w-1",
        ts: 1000,
      };
      expect(computeExpiresAt(event)).toBeUndefined();
    });

    it("ttl=0 返回 ts（立即过期）", () => {
      const event = {
        type: "progress" as const,
        src: "w-1",
        ts: 1000,
        ttl: 0,
      };
      expect(computeExpiresAt(event)).toBe(1000);
    });

    it("ttl>0 返回 ts + ttl", () => {
      const event = {
        type: "progress" as const,
        src: "w-1",
        ts: 1000,
        ttl: 600000,
      };
      expect(computeExpiresAt(event)).toBe(601000);
    });
  });

  describe("isExpired", () => {
    it("expiresAt 未设时返回 false（永不过期）", () => {
      const event: SignalEvent = {
        id: "sig-1",
        type: "progress",
        src: "w-1",
        ts: 1000,
      };
      expect(isExpired(event, 9999999)).toBe(false);
    });

    it("now < expiresAt 返回 false", () => {
      const event: SignalEvent = {
        id: "sig-1",
        type: "progress",
        src: "w-1",
        ts: 1000,
        expiresAt: 2000,
      };
      expect(isExpired(event, 1999)).toBe(false);
    });

    it("now == expiresAt 返回 true（边界）", () => {
      const event: SignalEvent = {
        id: "sig-1",
        type: "progress",
        src: "w-1",
        ts: 1000,
        expiresAt: 2000,
      };
      expect(isExpired(event, 2000)).toBe(true);
    });

    it("now > expiresAt 返回 true", () => {
      const event: SignalEvent = {
        id: "sig-1",
        type: "progress",
        src: "w-1",
        ts: 1000,
        expiresAt: 2000,
      };
      expect(isExpired(event, 2001)).toBe(true);
    });
  });

  describe("SignalEvent 字段完整性", () => {
    it("可构造带所有可选字段的事件", () => {
      const event: SignalEvent = {
        id: "sig-1",
        type: "blocked",
        src: "w-1",
        ts: 1000,
        taskId: "20260601175426-mtgl",
        ttl: 600000,
        expiresAt: 601000,
        data: { file: "x.ts" },
        refs: ["src/P0/signal.ts"],
        severity: "med",
        artifacts: [".dteam/signal/w-1.jsonl"],
      };
      expect(event.severity).toBe("med");
      expect(event.taskId).toBe("20260601175426-mtgl");
      expect(event.artifacts).toEqual([".dteam/signal/w-1.jsonl"]);
    });

    it("4 种 SignalType 都能构造", () => {
      const types = ["progress", "blocked", "found", "help"] as const;
      for (const type of types) {
        const event: SignalEvent = {
          id: `sig-${type}`,
          type,
          src: "w-1",
          ts: 1000,
        };
        expect(event.type).toBe(type);
      }
    });

    it("3 种 severity 都能构造", () => {
      const sevs = ["low", "med", "high"] as const;
      for (const severity of sevs) {
        const event: SignalEvent = {
          id: `sig-${severity}`,
          type: "blocked",
          src: "w-1",
          ts: 1000,
          severity,
        };
        expect(event.severity).toBe(severity);
      }
    });
  });
});
