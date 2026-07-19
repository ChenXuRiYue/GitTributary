export const SAMPLE_WORKFLOW = `name: 每日晚间备份

gt:
  id: flow.daily_evening_backup
  enabled: false
  description: 每天 18:00 检查当前仓库,有变更则提交

on:
  workflow_dispatch:

jobs:
  backup:
    runs-on: gittributary-local
    steps:
      - id: commit
        uses: gittributary/git/commit-all@v1
`;

export const DEFAULT_FLOW_FOLDER = "未分类";
