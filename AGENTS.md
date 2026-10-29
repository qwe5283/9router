# 项目协作规范

本文件适用于整个仓库；修改子目录时，同时遵循该目录下的 `AGENTS.md`。

## 功能变更后的推送前检查

每次新增、修改或删除功能（包括行为修复）后，必须在推送前检查 `origin` 与 `upstream` 的差异，并更新 `README.md` 的「相比上游的 rebase 功能清单」。代码变更与清单更新应在同一次交付中完成。

1. 阅读现有 rebase 清单，确认本次变更影响哪些条目。
2. 检查远程配置并获取两个远程的最新状态：

   ```sh
   git remote -v
   git fetch --multiple origin upstream
   ```

   当前比较分支为 `origin/master` 与 `upstream/master`；如果远程或默认分支已变更，使用实际对应分支。拉取失败时，说明失败原因，将差异检查标记为未完成，待获取最新状态并完成检查后再推送。

3. 分别检查远程差异与尚未推送的本地变更：

   ```sh
   git log --left-right --cherry-pick --oneline upstream/master...origin/master
   git diff --name-status upstream/master origin/master
   git log --oneline origin/master..HEAD
   git diff --stat origin/master
   git diff --name-status upstream/master
   git status --short
   ```

   提交列表用于定位变更；对本次修改及受影响的历史清单条目，继续按文件查看实际 diff，核对最终行为。检查应覆盖待推送提交、暂存区、工作区以及准备交付的未跟踪文件；其他未提交改动保留原样。
4. 依据实际差异更新 README 清单：新增功能补充条目，已有功能修改原条目，删除功能或已被上游完整覆盖的差异移除或合并条目。说明用途、适用范围、默认行为和重要限制，覆盖用户可感知的修复、配置、部署及发布能力。首次 fork 的提交号仅作历史说明，当前差异以最新远程和准备交付的代码为准。
5. 执行与变更范围匹配的验证及 `git diff --check`。完成标准：每项准备交付的功能差异都有准确的清单说明，受影响的旧条目已核对，清单与代码一起纳入交付。仅修改文档或流程时，不新增虚构的产品功能。

交付说明应简要报告比较的分支、README 清单更新和验证结果；无法完成的检查应明确标注。
