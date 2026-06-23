import { cn } from "@/lib/utils";

/**
 * GitTributary APP 图标
 * 三条支流汇入主干 + 入海圆点,套在圆角方形背景中。
 * macOS 应用图标质感。
 */
export function BrandIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 120"
      className={cn("size-6", className)}
    >
      <defs>
        <linearGradient id="gt-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1e3a5f" />
          <stop offset="100%" stopColor="#0f1f33" />
        </linearGradient>
        <linearGradient id="gt-stream" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
        <radialGradient id="gt-ocean" cx="78%" cy="50%" r="20%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.3" />
        </radialGradient>
      </defs>

      {/* 圆角方形背景(macOS icon 风格) */}
      <rect
        x="4"
        y="4"
        width="112"
        height="112"
        rx="26"
        ry="26"
        fill="url(#gt-bg)"
      />

      {/* 三条支流 */}
      <path
        d="M24 32 C38 36, 50 46, 64 58"
        stroke="url(#gt-stream)"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M20 60 C36 60, 48 59, 64 58"
        stroke="url(#gt-stream)"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M24 88 C38 84, 50 72, 64 58"
        stroke="url(#gt-stream)"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />

      {/* 主干 */}
      <path
        d="M64 58 C72 58, 78 58, 82 58"
        stroke="#38bdf8"
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      />

      {/* 入海:发光圆点 */}
      <circle cx="90" cy="58" r="12" fill="url(#gt-ocean)" />
      <circle cx="90" cy="58" r="7" fill="#38bdf8" fillOpacity="0.6" />
      <circle cx="90" cy="58" r="3.5" fill="#ffffff" fillOpacity="0.8" />
    </svg>
  );
}
