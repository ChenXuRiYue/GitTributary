import { cn } from "@/lib/utils";

/**
 * 大尺寸品牌动画:河流水系汇入磅礴大海。
 * 用于 splash 页、关于页、或首次打开时的品牌展示。
 *
 * 设计:
 * - 下半部是深蓝渐变的大海(CSS 渐变 + 波浪动画)
 * - 上半部是河流水系(SVG),从上方各处汇聚后注入海中
 * - 海面有多层波浪(不同速度、不同透明度),营造深邃磅礴感
 */
export function BrandSplash({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden rounded-2xl",
        className,
      )}
    >
      {/* ─── 大海背景(占下方 60%) ─── */}
      <div className="absolute inset-0 flex flex-col">
        {/* 天空/留白 */}
        <div className="flex-[4] bg-transparent" />
        {/* 海面渐变 */}
        <div
          className="flex-[6] relative"
          style={{
            background:
              "linear-gradient(to bottom, oklch(0.55 0.15 240 / 0.6), oklch(0.35 0.12 240 / 0.85), oklch(0.2 0.08 250 / 0.95))",
          }}
        >
          {/* 波浪层 1(最前,最快) */}
          <svg
            className="absolute -top-3 left-0 w-full animate-[wave_6s_ease-in-out_infinite]"
            viewBox="0 0 400 30"
            preserveAspectRatio="none"
            style={{ height: "20px" }}
          >
            <path
              d="M0 15 C30 5, 70 25, 100 15 C130 5, 170 25, 200 15 C230 5, 270 25, 300 15 C330 5, 370 25, 400 15 L400 30 L0 30 Z"
              fill="oklch(0.5 0.14 240 / 0.5)"
            />
          </svg>
          {/* 波浪层 2(中层) */}
          <svg
            className="absolute -top-1 left-0 w-full animate-[wave_8s_ease-in-out_infinite_reverse]"
            viewBox="0 0 400 30"
            preserveAspectRatio="none"
            style={{ height: "16px" }}
          >
            <path
              d="M0 15 C40 8, 80 22, 120 15 C160 8, 200 22, 240 15 C280 8, 320 22, 360 15 C380 10, 400 18, 400 15 L400 30 L0 30 Z"
              fill="oklch(0.45 0.13 240 / 0.4)"
            />
          </svg>
          {/* 波浪层 3(后层,最慢) */}
          <svg
            className="absolute -top-5 left-0 w-full animate-[wave_10s_ease-in-out_infinite]"
            viewBox="0 0 400 30"
            preserveAspectRatio="none"
            style={{ height: "24px" }}
          >
            <path
              d="M0 20 C50 10, 100 25, 150 18 C200 10, 250 26, 300 18 C350 10, 380 22, 400 18 L400 30 L0 30 Z"
              fill="oklch(0.4 0.12 245 / 0.3)"
            />
          </svg>
        </div>
      </div>

      {/* ─── 河流水系(SVG 覆盖在上方) ─── */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 200 200"
        className="relative z-10 h-full w-full"
        fill="none"
      >
        <defs>
          <linearGradient id="splash-river" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="oklch(0.7 0.12 220)" stopOpacity="0.4" />
            <stop offset="70%" stopColor="oklch(0.55 0.15 235)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="oklch(0.45 0.14 240)" stopOpacity="0.6" />
          </linearGradient>
        </defs>

        {/* 毛细支流 */}
        <g stroke="oklch(0.6 0.1 220)" strokeWidth="0.8" strokeOpacity="0.3" strokeLinecap="round">
          <path d="M30 10 C32 15, 34 20, 38 28" />
          <path d="M50 5 C48 12, 46 20, 45 28" />
          <path d="M15 20 C20 25, 28 30, 35 35" />
          <path d="M70 8 C65 15, 60 22, 55 30" />
          <path d="M90 12 C85 18, 78 25, 72 32" />
          <path d="M110 5 C105 12, 98 20, 92 28" />
          <path d="M135 10 C128 18, 120 26, 112 34" />
          <path d="M160 8 C152 16, 145 24, 138 32" />
          <path d="M175 15 C168 22, 160 28, 152 35" />
          <path d="M185 25 C178 30, 170 35, 162 40" />
        </g>

        {/* 小支流 → 汇入中支流 */}
        <g stroke="oklch(0.55 0.12 225)" strokeWidth="1.5" strokeOpacity="0.45" strokeLinecap="round">
          <path d="M38 28 C40 35, 44 42, 50 50">
            <animate attributeName="stroke-dashoffset" values="0;-16" dur="3s" repeatCount="indefinite" />
            <animate attributeName="stroke-dasharray" values="4,4;5,3;4,4" dur="3s" repeatCount="indefinite" />
          </path>
          <path d="M55 30 C54 38, 52 45, 52 52">
            <animate attributeName="stroke-dashoffset" values="0;-14" dur="2.7s" repeatCount="indefinite" />
            <animate attributeName="stroke-dasharray" values="4,3;3,4;4,3" dur="2.7s" repeatCount="indefinite" />
          </path>
          <path d="M72 32 C68 40, 64 48, 60 55">
            <animate attributeName="stroke-dashoffset" values="0;-15" dur="3.2s" repeatCount="indefinite" />
            <animate attributeName="stroke-dasharray" values="3,4;4,3;3,4" dur="3.2s" repeatCount="indefinite" />
          </path>
          <path d="M92 28 C88 36, 82 44, 78 52">
            <animate attributeName="stroke-dashoffset" values="0;-14" dur="2.9s" repeatCount="indefinite" />
            <animate attributeName="stroke-dasharray" values="4,4;3,5;4,4" dur="2.9s" repeatCount="indefinite" />
          </path>
          <path d="M112 34 C108 42, 104 50, 100 57">
            <animate attributeName="stroke-dashoffset" values="0;-16" dur="3.1s" repeatCount="indefinite" />
            <animate attributeName="stroke-dasharray" values="4,3;3,4;4,3" dur="3.1s" repeatCount="indefinite" />
          </path>
          <path d="M138 32 C132 40, 126 48, 120 56">
            <animate attributeName="stroke-dashoffset" values="0;-14" dur="2.8s" repeatCount="indefinite" />
            <animate attributeName="stroke-dasharray" values="3,4;4,3;3,4" dur="2.8s" repeatCount="indefinite" />
          </path>
          <path d="M152 35 C146 43, 140 50, 134 58">
            <animate attributeName="stroke-dashoffset" values="0;-15" dur="3.3s" repeatCount="indefinite" />
            <animate attributeName="stroke-dasharray" values="4,4;5,3;4,4" dur="3.3s" repeatCount="indefinite" />
          </path>
          <path d="M162 40 C155 47, 148 54, 140 60">
            <animate attributeName="stroke-dashoffset" values="0;-12" dur="2.6s" repeatCount="indefinite" />
            <animate attributeName="stroke-dasharray" values="3,3;4,3;3,3" dur="2.6s" repeatCount="indefinite" />
          </path>
        </g>

        {/* 中支流 → 汇入主支流 */}
        <g stroke="oklch(0.5 0.14 230)" strokeWidth="2.5" strokeOpacity="0.65" strokeLinecap="round">
          <path d="M50 50 C55 58, 62 66, 70 74">
            <animate attributeName="stroke-dashoffset" values="0;-20" dur="3.5s" repeatCount="indefinite" />
            <animate attributeName="stroke-dasharray" values="6,4;5,5;6,4" dur="3.5s" repeatCount="indefinite" />
          </path>
          <path d="M60 55 C68 62, 76 70, 82 78">
            <animate attributeName="stroke-dashoffset" values="0;-18" dur="3.2s" repeatCount="indefinite" />
            <animate attributeName="stroke-dasharray" values="5,5;6,4;5,5" dur="3.2s" repeatCount="indefinite" />
          </path>
          <path d="M100 57 C96 65, 94 72, 92 80">
            <animate attributeName="stroke-dashoffset" values="0;-18" dur="3.4s" repeatCount="indefinite" />
            <animate attributeName="stroke-dasharray" values="6,4;4,6;6,4" dur="3.4s" repeatCount="indefinite" />
          </path>
          <path d="M120 56 C116 64, 112 72, 108 80">
            <animate attributeName="stroke-dashoffset" values="0;-20" dur="3.6s" repeatCount="indefinite" />
            <animate attributeName="stroke-dasharray" values="5,5;6,4;5,5" dur="3.6s" repeatCount="indefinite" />
          </path>
          <path d="M140 60 C134 68, 126 74, 118 82">
            <animate attributeName="stroke-dashoffset" values="0;-18" dur="3.3s" repeatCount="indefinite" />
            <animate attributeName="stroke-dasharray" values="6,4;5,5;6,4" dur="3.3s" repeatCount="indefinite" />
          </path>
        </g>

        {/* 主支流 → 汇入主干 */}
        <g stroke="oklch(0.45 0.15 235)" strokeWidth="3.5" strokeOpacity="0.8" strokeLinecap="round">
          <path d="M70 74 C78 82, 86 90, 95 98">
            <animate attributeName="stroke-dashoffset" values="0;-24" dur="4s" repeatCount="indefinite" />
            <animate attributeName="stroke-dasharray" values="7,5;5,7;7,5" dur="4s" repeatCount="indefinite" />
          </path>
          <path d="M92 80 C94 86, 96 92, 98 98">
            <animate attributeName="stroke-dashoffset" values="0;-20" dur="3.8s" repeatCount="indefinite" />
            <animate attributeName="stroke-dasharray" values="6,5;5,6;6,5" dur="3.8s" repeatCount="indefinite" />
          </path>
          <path d="M118 82 C112 88, 108 94, 103 100">
            <animate attributeName="stroke-dashoffset" values="0;-22" dur="4.2s" repeatCount="indefinite" />
            <animate attributeName="stroke-dasharray" values="7,5;5,7;7,5" dur="4.2s" repeatCount="indefinite" />
          </path>
        </g>

        {/* 主干:粗壮,直流入海 */}
        <path
          d="M95 98 C98 108, 100 118, 100 130"
          stroke="url(#splash-river)"
          strokeWidth="5"
          strokeLinecap="round"
        >
          <animate attributeName="stroke-dashoffset" values="0;-30" dur="4.5s" repeatCount="indefinite" />
          <animate attributeName="stroke-dasharray" values="10,5;7,8;10,5" dur="4.5s" repeatCount="indefinite" />
        </path>
      </svg>

      {/* ─── 品牌文字 ─── */}
      <div className="absolute bottom-6 z-20 flex flex-col items-center gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-lg">
          GitTributary
        </h1>
        <p className="text-xs text-white/60">
          海纳百川,有容乃大
        </p>
      </div>
    </div>
  );
}
