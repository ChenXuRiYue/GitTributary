import { FileDown, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ─── Review Panel ─────────────────────────────────────────────────────

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

// ─── AI Panel ─────────────────────────────────────────────────────────

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

// ─── Database Panel ───────────────────────────────────────────────────

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
