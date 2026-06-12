import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DTEAM_CONFIG } from "../config.js";
import type { FileBoundaryStatus, FileGraph, FileGraphNode, FileGraphUnresolvedImport, PlanStep } from "../tools.js";

export interface BuildFileGraphOptions {
  cwd?: string;
  maxScanFiles?: number;
  supportedExtensions?: string[];
}

interface GraphBuildState {
  cwd: string;
  maxScanFiles: number;
  extensions: string[];
  nodes: Map<string, FileGraphNode>;
  unresolved: FileGraphUnresolvedImport[];
  truncated: boolean;
}

const IMPORT_EXPORT_RE = /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
const REQUIRE_RE = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

export function buildFileGraphFromSteps(steps: PlanStep[], options: BuildFileGraphOptions = {}): FileGraph {
  const roots = unique(steps.flatMap((step) => step.files ?? []));
  const hasUnknownBoundary = steps.some((step) => !step.files || step.files.length === 0);
  return buildFileGraph(roots, { ...options, hasUnknownBoundary });
}

export function buildFileGraph(
  files: string[],
  options: BuildFileGraphOptions & { hasUnknownBoundary?: boolean } = {},
): FileGraph {
  const state = createState(options);
  const roots = unique(files.map((file) => normalizeInputFile(file, state.cwd)).filter(Boolean));

  for (const root of roots) scanFile(root, state);

  linkImportedBy(state.nodes);

  return {
    roots,
    nodes: [...state.nodes.values()].sort((a, b) => a.file.localeCompare(b.file)),
    unresolved: state.unresolved,
    boundaryStatus: boundaryStatus(state, roots, options.hasUnknownBoundary ?? false),
    truncated: state.truncated || undefined,
  };
}

function createState(options: BuildFileGraphOptions): GraphBuildState {
  return {
    cwd: path.resolve(options.cwd ?? process.cwd()),
    maxScanFiles: options.maxScanFiles ?? DTEAM_CONFIG.scheduler.maxScanFiles,
    extensions: options.supportedExtensions ?? [...DTEAM_CONFIG.scheduler.supportedExtensions],
    nodes: new Map(),
    unresolved: [],
    truncated: false,
  };
}

function scanFile(file: string, state: GraphBuildState): void {
  if (state.nodes.has(file)) return;
  if (state.nodes.size >= state.maxScanFiles) {
    state.truncated = true;
    return;
  }

  const absolute = path.resolve(state.cwd, file);
  const exists = existsSync(absolute) && statSync(absolute).isFile();
  const node: FileGraphNode = { file, imports: [], importedBy: [], exists };
  state.nodes.set(file, node);

  if (!exists) {
    state.unresolved.push({ from: file, specifier: file, reason: "文件不存在" });
    return;
  }
  if (!isSupportedFile(file, state.extensions)) return;

  node.imports = resolveSpecifiers(file, readFileSync(absolute, "utf8"), state);
  for (const imported of node.imports) scanFile(imported, state);
}

function resolveSpecifiers(file: string, source: string, state: GraphBuildState): string[] {
  const imports: string[] = [];
  for (const specifier of extractSpecifiers(source)) {
    if (!specifier.startsWith(".")) continue;
    const resolved = resolveRelativeImport(file, specifier, state);
    if (resolved) imports.push(resolved);
    else state.unresolved.push({ from: file, specifier, reason: "无法解析相对导入" });
  }
  return unique(imports);
}

export function extractSpecifiers(source: string): string[] {
  return unique([...matchAll(IMPORT_EXPORT_RE, source), ...matchAll(REQUIRE_RE, source)]);
}

function resolveRelativeImport(file: string, specifier: string, state: GraphBuildState): string | null {
  const base = path.dirname(path.resolve(state.cwd, file));
  const target = path.resolve(base, specifier);
  const candidates = importCandidates(target, state.extensions);
  const found = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  return found ? toProjectPath(found, state.cwd) : null;
}

function importCandidates(target: string, extensions: string[]): string[] {
  const candidates = [target];
  if (!path.extname(target)) candidates.push(...extensions.map((ext) => `${target}${ext}`));
  candidates.push(...extensions.map((ext) => path.join(target, `index${ext}`)));
  return candidates;
}

function linkImportedBy(nodes: Map<string, FileGraphNode>): void {
  for (const node of nodes.values()) {
    for (const imported of node.imports) {
      const target = nodes.get(imported);
      if (target && !target.importedBy.includes(node.file)) target.importedBy.push(node.file);
    }
  }
  for (const node of nodes.values()) node.importedBy.sort();
}

function boundaryStatus(state: GraphBuildState, roots: string[], hasUnknownBoundary: boolean): FileBoundaryStatus {
  if (state.truncated) return "truncated";
  if (hasUnknownBoundary || roots.length === 0) return "unknown";
  if (state.unresolved.length > 0) return "unresolved";
  return "known";
}

function normalizeInputFile(file: string, cwd: string): string {
  const absolute = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  return toProjectPath(absolute, cwd);
}

function toProjectPath(absolute: string, cwd: string): string {
  return path.relative(cwd, absolute).split(path.sep).join("/");
}

function isSupportedFile(file: string, extensions: string[]): boolean {
  return extensions.includes(path.extname(file));
}

function matchAll(regex: RegExp, source: string): string[] {
  regex.lastIndex = 0;
  return [...source.matchAll(regex)].map((match) => match[1]).filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
