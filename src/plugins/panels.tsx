import { FolderOpen, Send, FileDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** 通用区块卡片 */
function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function BackupPanel() {
  return (
    <>
      <Block title="笔记仓库">
        <div className="flex items-center gap-2">
          <Input placeholder="未选择笔记目录…" readOnly />
          <Button variant="outline">
            <FolderOpen /> 选择目录
          </Button>
        </div>
      </Block>

      <Block title="变更概览">
        <ul className="flex flex-col gap-2 text-sm">
          <li className="flex items-center gap-2">
            <Badge variant="secondary" className="text-yellow-600">
              M
            </Badge>
            <span className="text-muted-foreground">notes/2026-周报.md</span>
          </li>
          <li className="flex items-center gap-2">
            <Badge variant="secondary" className="text-primary">
              A
            </Badge>
            <span className="text-muted-foreground">notes/灵感.md</span>
          </li>
          <li className="flex items-center gap-2">
            <Badge variant="secondary" className="text-destructive">
              D
            </Badge>
            <span className="text-muted-foreground">draft/旧草稿.md</span>
          </li>
        </ul>
      </Block>

      <Block title="一键备份">
        <div className="flex flex-col gap-3">
          <Textarea placeholder="提交信息（留空则自动生成）…" />
          <div className="flex justify-end">
            <Button>
              <Send /> 提交并推送
            </Button>
          </div>
        </div>
      </Block>
    </>
  );
}

export function ReviewPanel() {
  return (
    <>
      <Block title="复习曲线">
        <p className="text-sm text-muted-foreground">
          基于遗忘曲线提示今天该回顾的笔记。
        </p>
      </Block>
      <Block title="今日待复习">
        <ul className="flex flex-col gap-2 text-sm">
          <li>算法 · 并查集</li>
          <li>Rust · 所有权与借用</li>
          <li>设计 · 状态机模式</li>
        </ul>
      </Block>
      <Block title="导出">
        <Button variant="outline">
          <FileDown /> 导出当周复习 PDF
        </Button>
      </Block>
    </>
  );
}

export function AiPanel() {
  return (
    <>
      <Block title="AI 助手">
        <p className="text-sm text-muted-foreground">
          活用 AI，打造博学、富有洞察力的笔记助手。
        </p>
      </Block>
      <Block title="对话">
        <div className="flex flex-col gap-3">
          <div className="bg-muted text-foreground self-start rounded-lg px-3 py-2 text-sm">
            你好，我可以帮你总结、检索、生成提交信息。
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="问点什么…" />
            <Button>
              <Send /> 发送
            </Button>
          </div>
        </div>
      </Block>
    </>
  );
}

export function DatabasePanel() {
  return (
    <>
      <Block title="笔记数据库">
        <p className="text-sm text-muted-foreground">
          为「笔记库 + AI」而生的数据库视图。
        </p>
      </Block>
      <Block title="标签 / 元数据">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">#工具书</Badge>
          <Badge variant="outline">#日记</Badge>
          <Badge variant="outline">#算法</Badge>
          <Badge variant="outline">#待整理</Badge>
        </div>
      </Block>
    </>
  );
}

function SettingRow({
  label,
  defaultChecked,
}: {
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm">{label}</span>
      <Switch defaultChecked={defaultChecked} />
    </div>
  );
}

export function SettingsPanel() {
  return (
    <>
      <Block title="通用">
        <SettingRow label="启用非 Git 模式" />
        <SettingRow label="监听目录变更" defaultChecked />
      </Block>
      <Block title="安全">
        <SettingRow label="个人信息脱敏" />
        <SettingRow label="日记加密" />
      </Block>
      <Block title="插件">
        <Button variant="outline">管理插件…</Button>
      </Block>
    </>
  );
}
