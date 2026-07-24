import { cn } from "@/shared/lib/utils";
import { APP_DISPLAY_NAME } from "@/shared/brand";
import appIcon from "../../../src-tauri/icons/icon.png";

export function BrandIcon({ className }: { className?: string }) {
  return (
    <img
      src={appIcon}
      alt={APP_DISPLAY_NAME}
      className={cn("size-6 rounded-[22%] object-cover", className)}
      draggable={false}
    />
  );
}
