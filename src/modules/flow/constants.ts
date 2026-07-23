export const SAMPLE_WORKFLOW = `name: 检查当前仓库

gn:
  id: flow.check_workspace
  enabled: false
  description: 检查当前仓库路径存在且不为空

on:
  workflow_dispatch:

jobs:
  check:
    runs-on: noteaura-local
    steps:
      - id: repository
        uses: noteaura/files/assert-exists@v1
        with:
          path: \${{ gn.workspace.active_repo }}
          non_empty: true
`;

export const DEFAULT_FLOW_FOLDER = "未分类";
