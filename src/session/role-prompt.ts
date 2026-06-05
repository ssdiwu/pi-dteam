/**
 * dteam v1 — 角色 systemPrompt 加载
 *
 * 从 agents/{role}.md 读取 body 部分（去掉 frontmatter）。
 * 同步 fs.readFileSync 行为（不切 fs/promises，保持稳定）。
 * 找不到文件时 fallback 到 ROLE_DEFAULTS 的 description。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RoleName } from "../types/role.js";
import { ROLE_DEFAULTS } from "./role-config.js";

/** 获取角色的 systemPrompt（从 agents/*.md 读取 body 部分） */
export function loadRolePrompt(role: RoleName, cwd: string): string {
  // 尝试从 agents/ 目录加载
  const candidates = [
    resolve(cwd, "agents", `${role}.md`),
    resolve(process.cwd(), "agents", `${role}.md`),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf-8");
      // 去掉 frontmatter（--- ... ---）
      const body = raw.replace(/^---[\s\S]*?---\s*/, "").trim();
      if (body) return body;
    } catch { /* try next */ }
  }
  // fallback：角色名 + 描述
  const cfg = ROLE_DEFAULTS[role];
  return `你是 dteam 的 ${role}（${cfg.description}）。请完成分配给你的任务。`;
}
