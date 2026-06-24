import { cn } from "@/lib/utils";
import brandIcon from "@/assets/brand-icon.png";

export function BrandIcon({ className }: { className?: string }) {
  return (
    <img
      src={brandIcon}
      alt="Git Tributary"
      className={cn("size-6 rounded-[22%] object-cover", className)}
      draggable={false}
    />
  );
}
