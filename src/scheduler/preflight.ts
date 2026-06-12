import type { FileGraph, PlanStep, SchedulingBatch, SchedulingConflict, SchedulingDelay, SchedulingPlan } from "../tools.js";
import { sharedFiles } from "./shared-files.js";

interface Edge {
  from: number;
  to: number;
  reason: string;
}

export function preflightSchedule(steps: PlanStep[], fileGraph: FileGraph): SchedulingPlan {
  const conflicts: SchedulingConflict[] = [];
  const edges: Edge[] = [];

  collectUnknownConflicts(steps, conflicts);
  collectHardConflicts(steps, conflicts, edges);
  collectSharedConflicts(steps, conflicts, edges);
  collectDependencyConflicts(steps, fileGraph, conflicts, edges);

  const batches = buildBatches(steps.length, edges);
  return { batches, conflicts, delayedSteps: delayedSteps(batches, edges) };
}

function collectUnknownConflicts(steps: PlanStep[], conflicts: SchedulingConflict[]): void {
  steps.forEach((step, index) => {
    if (!step.files || step.files.length === 0) {
      conflicts.push({ type: "unknown", stepIndexes: [index], reason: "step 未声明 files，调度边界未知" });
    }
  });
}

function collectHardConflicts(steps: PlanStep[], conflicts: SchedulingConflict[], edges: Edge[]): void {
  for (const [file, indexes] of fileOwners(steps)) {
    if (indexes.length < 2) continue;
    conflicts.push({ type: "hard", stepIndexes: indexes, files: [file], reason: `多个 step 声明同一文件：${file}` });
    addOrderedEdges(indexes, edges, `同文件冲突：${file}`);
  }
}

function collectSharedConflicts(steps: PlanStep[], conflicts: SchedulingConflict[], edges: Edge[]): void {
  steps.forEach((step, index) => {
    const files = sharedFiles(step.files ?? []);
    if (files.length === 0) return;
    const related = knownStepIndexes(steps).filter((other) => other !== index);
    if (related.length === 0) return;
    const stepIndexes = [index, ...related].sort((a, b) => a - b);
    conflicts.push({ type: "shared", stepIndexes, files, reason: `共享文件需保守串行：${files.join(", ")}` });
    addOrderedEdges(stepIndexes, edges, `共享文件冲突：${files.join(", ")}`);
  });
}

function collectDependencyConflicts(
  steps: PlanStep[],
  fileGraph: FileGraph,
  conflicts: SchedulingConflict[],
  edges: Edge[],
): void {
  const owners = fileOwners(steps);
  for (const node of fileGraph.nodes) {
    const importerOwners = owners.get(node.file) ?? [];
    for (const imported of node.imports) {
      const importedOwners = owners.get(imported) ?? [];
      for (const importedOwner of importedOwners) {
        for (const importerOwner of importerOwners) {
          if (importedOwner === importerOwner) continue;
          conflicts.push({
            type: "dependency",
            stepIndexes: [importedOwner, importerOwner],
            files: [imported, node.file],
            reason: `${node.file} 依赖 ${imported}，被依赖方先执行`,
          });
          addEdge(edges, importedOwner, importerOwner, `依赖方向：${imported} → ${node.file}`);
        }
      }
    }
  }
}

function buildBatches(stepCount: number, edges: Edge[]): SchedulingBatch[] {
  const remaining = new Set(Array.from({ length: stepCount }, (_, index) => index));
  const batches: SchedulingBatch[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((index) => incomingEdges(index, edges).every((edge) => !remaining.has(edge.from)));
    const stepIndexes = ready.length > 0 ? ready : [Math.min(...remaining)];
    batches.push({ index: batches.length, stepIndexes, reason: batchReason(stepIndexes, edges) });
    for (const index of stepIndexes) remaining.delete(index);
  }
  return batches;
}

function delayedSteps(batches: SchedulingBatch[], edges: Edge[]): SchedulingDelay[] {
  const batchIndexByStep = new Map<number, number>();
  for (const batch of batches) for (const stepIndex of batch.stepIndexes) batchIndexByStep.set(stepIndex, batch.index);
  return [...batchIndexByStep.entries()]
    .filter(([, batchIndex]) => batchIndex > 0)
    .map(([stepIndex]) => ({ stepIndex, delayedBecause: unique(incomingEdges(stepIndex, edges).map((edge) => edge.reason)) }))
    .filter((delay) => delay.delayedBecause.length > 0)
    .sort((a, b) => a.stepIndex - b.stepIndex);
}

function fileOwners(steps: PlanStep[]): Map<string, number[]> {
  const owners = new Map<string, number[]>();
  steps.forEach((step, index) => {
    for (const file of unique(step.files ?? [])) {
      const indexes = owners.get(file) ?? [];
      indexes.push(index);
      owners.set(file, indexes);
    }
  });
  return owners;
}

function knownStepIndexes(steps: PlanStep[]): number[] {
  return steps.flatMap((step, index) => step.files && step.files.length > 0 ? [index] : []);
}

function addOrderedEdges(indexes: number[], edges: Edge[], reason: string): void {
  const sorted = [...indexes].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length - 1; i++) addEdge(edges, sorted[i], sorted[i + 1], reason);
}

function addEdge(edges: Edge[], from: number, to: number, reason: string): void {
  if (from === to) return;
  if (edges.some((edge) => edge.from === from && edge.to === to && edge.reason === reason)) return;
  edges.push({ from, to, reason });
}

function incomingEdges(stepIndex: number, edges: Edge[]): Edge[] {
  return edges.filter((edge) => edge.to === stepIndex);
}

function batchReason(stepIndexes: number[], edges: Edge[]): string {
  const reasons = unique(stepIndexes.flatMap((stepIndex) => incomingEdges(stepIndex, edges).map((edge) => edge.reason)));
  return reasons.length > 0 ? reasons.join("；") : "无前置冲突，可并行";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
