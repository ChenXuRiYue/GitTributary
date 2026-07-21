import { cn } from "@/shared/lib/utils";
import appIcon from "../../../src-tauri/icons/icon.png";

export function BrandIcon({ className }: { className?: string }) {
  return (
    <img
      src={appIcon}
      alt="Git Tributary"
      className={cn("size-6 rounded-[22%] object-cover", className)}
      draggable={false}
    />
  );
}
