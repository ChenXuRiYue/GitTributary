export const SAMPLE_WORKFLOW = `name: 检查当前仓库

gt:
  id: flow.check_workspace
  enabled: false
  description: 检查当前仓库路径存在且不为空

on:
  workflow_dispatch:

jobs:
  check:
    runs-on: gittributary-local
    steps:
      - id: repository
        uses: gittributary/files/assert-exists@v1
        with:
          path: \${{ gt.workspace.active_repo }}
          non_empty: true
`;

export const DEFAULT_FLOW_FOLDER = "未分类";
