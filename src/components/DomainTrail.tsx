import { cn } from "@/lib/utils";

export interface DomainTrailItem {
  id: string;
  label: string;
  title?: string;
}

interface DomainTrailProps {
  items: DomainTrailItem[];
  className?: string;
  ariaLabel?: string;
}

export function DomainTrail({
  items,
  className,
  ariaLabel = "当前位置",
}: DomainTrailProps) {
  if (items.length === 0) return null;

  const title = items.map((item) => item.title ?? item.label).join(" / ");

  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-1.5",
        className,
      )}
      title={title}
    >
      {items.map((item, index) => {
        const isLeaf = index === items.length - 1;

        return (
          <span key={item.id} className="flex min-w-0 items-center gap-1.5">
            {index > 0 ? (
              <span className="shrink-0 text-muted-foreground/60 gt-body">/</span>
            ) : null}
            <span
              aria-current={isLeaf ? "page" : undefined}
              className={cn(
                "truncate",
                index === 0
                  ? "max-w-[9rem] text-foreground gt-title-panel"
                  : "max-w-[8rem] text-muted-foreground gt-body-strong",
              )}
              title={item.title ?? item.label}
            >
              {item.label}
            </span>
          </span>
        );
      })}
    </nav>
  );
}
