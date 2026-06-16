---
name: test-runner
slug: test-runner
version: 0.1.0
description: >
  处理明确的测试工作，例如添加测试、运行正确的测试命令、提升覆盖率或缩小失败测试范围。当用户的主要请求是测试而非通用实现时触发。
triggers:
  - add tests for this
  - run or fix the test suite
  - improve coverage
  - isolate failing tests
not_when:
  - implement the feature itself as the main job
  - do general debugging without a testing focus
  - do browser interaction unrelated to test execution
  - perform security review as the primary task
family: engineering
dependencies:
  tools:
    - exec_command
  local_files:
    - /Users/diwu/.agents/skills/test-runner/references/test-scope-rules.md
  services: []
---

# Test Runner（测试执行器）

## 目的

当测试是主要产出物时，提供编写、运行和缩小测试范围的专用通道。

## 适用场景

- 用户明确要求添加、运行、修复或改进测试。
- 需要将失败缩小到最小的相关测试范围。
- 提升覆盖率是主要诉求。
- 任务是为代码库选择并运行正确的测试命令。

边界示例：

- 如果用户要求实现一个功能且测试只是附带工作，使用 `code-workflow`；如果用户明确要求添加或修复测试，则使用本技能。

## 不适用场景

- 主要产出物是代码实现而非测试。
- 任务是通用 bug 排查，没有明确的测试侧重点。
- 任务是 UI 浏览或调研，而非执行测试。
- 任务是安全加固。

## 输入 / 输出

- 输入：待测目标区域、当前失败行为、可用测试框架及可接受的验证范围。
- 输出：最相关的测试变更或运行结果、失败证据，以及关于通过/未通过的简要说明。

## 工作流程

1. 识别最窄的测试目标：文件、套件、用例或框架。
2. 优先运行最小有效测试集，再视情况升级到完整套件。
3. 仅在足以证明行为的范围内添加或修复测试。
4. 尽可能报告实际测试执行的具体结果。
5. 若真正的阻塞点变为功能实现而非测试本身，则交回 `code-workflow` 处理。

## 参考资源

- `references/test-scope-rules.md`：如何选择最小化运行范围、何时扩大范围以及如何报告证据。
