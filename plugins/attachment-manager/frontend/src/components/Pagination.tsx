import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/shared/ui/button";

export const PAGE_SIZE = 100;

export function Pagination({
  page,
  pageCount,
  total,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-2 flex items-center justify-end gap-1">
      <span className="text-muted-foreground gt-caption mr-2">{total} 项 · {page + 1}/{pageCount}</span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={page === 0}
        onClick={() => onPageChange(page - 1)}
        title="上一页"
      >
        <ChevronLeft className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={page >= pageCount - 1}
        onClick={() => onPageChange(page + 1)}
        title="下一页"
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
