/**
 * P3-workItemPlanner 单元测试
 *
 * 覆盖：
 * - materializeTaskToWorkItems（A 层 → workItems[]，B 层不进入）
 * - refreshWorkItemReadiness（todo → ready，依赖满足）
 * - claimNextWorkItem（取第一个 ready）
 * - projectChecklistStatus（从 workItems[] 派生）
 * - 边界：空 acceptance、dependsOn、HR-* 混入
 */

import { describe, it, expect } from "vitest";
import {
  materializeTaskToWorkItems,
  refreshWorkItemReadiness,
  claimNextWorkItem,
  projectChecklistStatus,
} from "../../src/P3/workItemPlanner.js";
import type {
  AcceptanceModel,
  WorkItem,
  WorkItemStatus,
} from "../../src/P0/workItem.js";

// ── helpers ───────────────────────────────────────────────────

function makeMachine(items: Array<[string, string]>): AcceptanceModel["machine"] {
  return items.map(([acId, acText]) => ({ acId, acText }));
}

const NOW = "2026-06-03T10:00:00.000Z";

// ── materializeTaskToWorkItems ────────────────────────────────

describe("workItemPlanner — materializeTaskToWorkItems", () => {
  it("A 层每条 AC 生成一个 workItem，id 复用 acId", () => {
    const model: AcceptanceModel = {
      machine: makeMachine([
        ["AC-1", "AC-1 typecheck 通过"],
        ["AC-2", "AC-2 测试全过"],
        ["AC-3", "AC-3 pi -e 加载成功"],
      ]),
      human: [],
    };

    const items = materializeTaskToWorkItems({
      taskPath: "/tmp/task.md",
      acceptance: model,
      now: NOW,
    });

    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id)).toEqual(["AC-1", "AC-2", "AC-3"]);
  });

  it("初始 status 全为 todo，dependsOn 为空，attempts/helpers 空数组", () => {
    const model: AcceptanceModel = {
      machine: makeMachine([["AC-1", "AC-1 build 集成"]]),
      human: [],
    };
    const items = materializeTaskToWorkItems({
      taskPath: "/tmp/task.md",
      acceptance: model,
      now: NOW,
    });

    expect(items[0].status).toBe("todo");
    expect(items[0].dependsOn).toEqual([]);
    expect(items[0].attempts).toEqual([]);
    expect(items[0].helpers).toEqual([]);
    expect(items[0].createdAt).toBe(NOW);
    expect(items[0].updatedAt).toBe(NOW);
  });

  it("source.kind = 'acceptance'，并写入 taskPath / acId / acText", () => {
    const model: AcceptanceModel = {
      machine: makeMachine([["AC-7", "AC-7 文件存在"]]),
      human: [],
    };
    const items = materializeTaskToWorkItems({
      taskPath: "/tmp/test.md",
      acceptance: model,
      now: NOW,
    });

    expect(items[0].source).toEqual({
      kind: "acceptance",
      taskPath: "/tmp/test.md",
      acId: "AC-7",
      acText: "AC-7 文件存在",
    });
  });

  it("B 层项不会进入 workItems[]（硬规则）", () => {
    const model: AcceptanceModel = {
      machine: makeMachine([
        ["AC-1", "AC-1 build 集成"],
        ["AC-2", "AC-2 check 全过"],
      ]),
      human: [
        "HR-1 UI 体验足够流畅",
        "HR-2 文档完整",
      ],
    };
    const items = materializeTaskToWorkItems({
      taskPath: "/tmp/task.md",
      acceptance: model,
      now: NOW,
    });

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id)).toEqual(["AC-1", "AC-2"]);
  });

  it("空 A 层返回空数组", () => {
    const model: AcceptanceModel = { machine: [], human: ["HR-1 仅人工项"] };
    const items = materializeTaskToWorkItems({
      taskPath: "/tmp/task.md",
      acceptance: model,
      now: NOW,
    });
    expect(items).toEqual([]);
  });

  it("默认 now = 当前时间（不传 now 时 createdAt 是有效 ISO）", () => {
    const model: AcceptanceModel = {
      machine: makeMachine([["AC-1", "AC-1 条件"]]),
      human: [],
    };
    const items = materializeTaskToWorkItems({
      taskPath: "/tmp/task.md",
      acceptance: model,
    });
    expect(items[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── refreshWorkItemReadiness ──────────────────────────────────

describe("workItemPlanner — refreshWorkItemReadiness", () => {
  /** 快速构造 workItem */
  function wi(id: string, status: WorkItemStatus, dependsOn: string[] = []): WorkItem {
    return {
      id,
      source: { kind: "acceptance", taskPath: "/tmp/task.md", acId: id, acText: id },
      title: id,
      acceptance: [id],
      status,
      dependsOn,
      attempts: [],
      helpers: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
  }

  it("无依赖的 todo → ready", () => {
    const items = [wi("AC-1", "todo")];
    const refreshed = refreshWorkItemReadiness(items);
    expect(refreshed[0].status).toBe("ready");
  });

  it("依赖全 done 的 todo → ready", () => {
    const items = [
      wi("AC-1", "done"),
      wi("AC-2", "todo", ["AC-1"]),
    ];
    const refreshed = refreshWorkItemReadiness(items);
    expect(refreshed[1].status).toBe("ready");
  });

  it("依赖还有非 done 的 → 保持 todo", () => {
    const items = [
      wi("AC-1", "in_progress"),
      wi("AC-2", "todo", ["AC-1"]),
    ];
    const refreshed = refreshWorkItemReadiness(items);
    expect(refreshed[1].status).toBe("todo");
  });

  it("非 todo 状态原样返回（不抢转）", () => {
    const items = [
      wi("AC-1", "ready"),
      wi("AC-2", "in_progress"),
      wi("AC-3", "done"),
      wi("AC-4", "skipped"),
      wi("AC-5", "waiting_help"),
      wi("AC-6", "blocked"),
    ];
    const refreshed = refreshWorkItemReadiness(items);
    expect(refreshed.map((i) => i.status)).toEqual([
      "ready",
      "in_progress",
      "done",
      "skipped",
      "waiting_help",
      "blocked",
    ]);
  });

  it("不修改入参数组（immutable）", () => {
    const items = [wi("AC-1", "todo")];
    const refreshed = refreshWorkItemReadiness(items);
    expect(items[0].status).toBe("todo");
    expect(refreshed).not.toBe(items);
  });
});

// ── claimNextWorkItem ─────────────────────────────────────────

describe("workItemPlanner — claimNextWorkItem", () => {
  function wi(id: string, status: WorkItemStatus): WorkItem {
    return {
      id,
      source: { kind: "acceptance", taskPath: "/tmp/task.md", acId: id, acText: id },
      title: id,
      acceptance: [id],
      status,
      dependsOn: [],
      attempts: [],
      helpers: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
  }

  it("返回第一个 ready 的项（按数组顺序）", () => {
    const items = [
      wi("AC-1", "todo"),
      wi("AC-2", "ready"),
      wi("AC-3", "ready"),
    ];
    const claimed = claimNextWorkItem(items);
    expect(claimed?.id).toBe("AC-2");
  });

  it("没有 ready 时返回 null", () => {
    const items = [wi("AC-1", "todo"), wi("AC-2", "in_progress")];
    expect(claimNextWorkItem(items)).toBeNull();
  });

  it("空数组返回 null", () => {
    expect(claimNextWorkItem([])).toBeNull();
  });

  it("不修改入参数组", () => {
    const items = [wi("AC-1", "ready")];
    const claimed = claimNextWorkItem(items);
    expect(claimed).not.toBeNull();
    expect(items[0].status).toBe("ready"); // 未被改成 in_progress
  });
});

// ── projectChecklistStatus ────────────────────────────────────

describe("workItemPlanner — projectChecklistStatus", () => {
  function wi(id: string, status: WorkItemStatus, ownerWorkerId?: string): WorkItem {
    return {
      id,
      source: { kind: "acceptance", taskPath: "/tmp/task.md", acId: id, acText: id },
      title: `${id} 描述`,
      acceptance: [`${id} 描述`],
      status,
      dependsOn: [],
      ...(ownerWorkerId !== undefined ? { ownerWorkerId } : {}),
      attempts: [],
      helpers: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
  }

  it("完全从 workItems[] 派生（顺序一致）", () => {
    const items = [
      wi("AC-1", "done"),
      wi("AC-2", "in_progress"),
      wi("AC-3", "ready"),
    ];
    const projection = projectChecklistStatus(items);
    expect(projection).toHaveLength(3);
    expect(projection.map((p) => p.id)).toEqual(["AC-1", "AC-2", "AC-3"]);
    expect(projection.map((p) => p.status)).toEqual([
      "done",
      "in_progress",
      "ready",
    ]);
  });

  it("text 来自 workItem.title", () => {
    const items = [wi("AC-1", "todo")];
    const projection = projectChecklistStatus(items);
    expect(projection[0].text).toBe("AC-1 描述");
  });

  it("ownerWorkerId 设置时，projection 含 workerId", () => {
    const items = [wi("AC-1", "in_progress", "worker-42")];
    const projection = projectChecklistStatus(items);
    expect(projection[0].workerId).toBe("worker-42");
  });

  it("ownerWorkerId 未设置时，projection 不含 workerId 字段", () => {
    const items = [wi("AC-1", "todo")];
    const projection = projectChecklistStatus(items);
    expect("workerId" in projection[0]).toBe(false);
  });

  it("空数组返回空数组", () => {
    expect(projectChecklistStatus([])).toEqual([]);
  });
});

// ── 端到端：materialize + refresh + claim + projection ────────

describe("workItemPlanner — 端到端 A 层主干", () => {
  it("materialize → refresh → claim → projection 链条正确", () => {
    const model: AcceptanceModel = {
      machine: makeMachine([
        ["AC-1", "AC-1 typecheck 通过"],
        ["AC-2", "AC-2 测试全过"],
        ["AC-3", "AC-3 pi 加载成功"],
      ]),
      human: ["HR-1 UI 体验"],
    };

    // 1. materialize：A 层 → 3 个 workItem，B 层不进入
    const items = materializeTaskToWorkItems({
      taskPath: "/tmp/task.md",
      acceptance: model,
      now: NOW,
    });
    expect(items.map((i) => i.id)).toEqual(["AC-1", "AC-2", "AC-3"]);

    // 2. refresh：3 个 todo → 3 个 ready
    const refreshed = refreshWorkItemReadiness(items);
    expect(refreshed.every((i) => i.status === "ready")).toBe(true);

    // 3. claim：取第一个（AC-1）
    const claimed = claimNextWorkItem(refreshed);
    expect(claimed?.id).toBe("AC-1");

    // 4. projection：3 个 status 投影
    const projection = projectChecklistStatus(refreshed);
    expect(projection).toHaveLength(3);
    expect(projection[0].id).toBe("AC-1");
    expect(projection[0].status).toBe("ready");
  });

  it("B 层项永远不会出现在 projection 里", () => {
    const model: AcceptanceModel = {
      machine: makeMachine([["AC-1", "AC-1 条件"]]),
      human: ["HR-1 体验足够好", "HR-2 文档完整"],
    };
    const items = materializeTaskToWorkItems({
      taskPath: "/tmp/task.md",
      acceptance: model,
      now: NOW,
    });
    const projection = projectChecklistStatus(items);
    for (const p of projection) {
      expect(p.id).not.toMatch(/HR-/);
      expect(p.text).not.toMatch(/体验/);
      expect(p.text).not.toMatch(/文档完整/);
    }
  });
});
