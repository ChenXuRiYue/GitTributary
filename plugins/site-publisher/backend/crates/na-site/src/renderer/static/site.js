(async function () {
  const shell = document.querySelector(".site-shell");
  const root = shell?.dataset.siteRoot || "";
  const sidebar = document.querySelector(".site-sidebar");
  const toggle = document.querySelector(".sidebar-toggle");
  const themeToggle = document.querySelector(".theme-toggle");
  const resizer = document.querySelector(".sidebar-resizer");
  const sidebarWidthKey = "na-site-sidebar-width-v2";
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const currentTheme = () => document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const updateThemeButton = () => {
    if (!themeToggle) return;
    const isDark = currentTheme() === "dark";
    themeToggle.dataset.theme = isDark ? "dark" : "light";
    themeToggle.setAttribute("aria-label", isDark ? "切换为亮色" : "切换为暗色");
    themeToggle.setAttribute("title", isDark ? "切换为亮色" : "切换为暗色");
  };
  const setTheme = (theme) => {
    const next = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("na-site-theme", next);
    updateThemeButton();
  };
  const setSidebarWidth = (value) => {
    const width = clamp(Math.round(value), 184, 520);
    document.documentElement.style.setProperty("--sidebar-width", width + "px");
    localStorage.setItem(sidebarWidthKey, String(width));
  };
  const setSidebarCollapsed = (collapsed) => {
    shell?.classList.toggle("sidebar-collapsed", collapsed);
    if (toggle) {
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.setAttribute("aria-label", collapsed ? "展开侧边栏" : "收起侧边栏");
      toggle.setAttribute("title", collapsed ? "展开侧边栏" : "收起侧边栏");
    }
    localStorage.setItem("na-site-sidebar-collapsed", collapsed ? "true" : "false");
  };
  updateThemeButton();
  themeToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    setTheme(currentTheme() === "dark" ? "light" : "dark");
  });
  const storedWidth = Number(localStorage.getItem(sidebarWidthKey));
  if (Number.isFinite(storedWidth) && storedWidth > 0) {
    setSidebarWidth(storedWidth);
  }
  setSidebarCollapsed(localStorage.getItem("na-site-sidebar-collapsed") === "true");
  document.addEventListener("click", (event) => {
    const target = event.target;
    const button = target?.closest ? target.closest(".sidebar-toggle") : null;
    if (!button) return;
    event.preventDefault();
    setSidebarCollapsed(!shell?.classList.contains("sidebar-collapsed"));
  }, true);
  resizer?.addEventListener("pointerdown", (event) => {
    if (shell?.classList.contains("sidebar-collapsed")) return;
    event.preventDefault();
    document.body.classList.add("sidebar-resizing");
    resizer.setPointerCapture(event.pointerId);
    const onMove = (moveEvent) => setSidebarWidth(moveEvent.clientX);
    const onUp = () => {
      document.body.classList.remove("sidebar-resizing");
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
  const active = document.querySelector(".site-nav a.active");
  if (active) {
    requestAnimationFrame(() => {
      const sidebarScroll = document.querySelector(".site-sidebar-scroll");
      if (!sidebarScroll || shell?.classList.contains("sidebar-collapsed")) return;
      const itemRect = active.getBoundingClientRect();
      const sidebarRect = sidebarScroll.getBoundingClientRect();
      sidebarScroll.scrollTop += itemRect.top - sidebarRect.top - sidebarRect.height / 2 + itemRect.height / 2;
    });
  }

  document.querySelectorAll(".site-nav details").forEach((details) => {
    const summary = details.querySelector("summary");
    const key = summary?.getAttribute("title");
    if (!key) return;
    const stored = localStorage.getItem("na-site-nav:" + key);
    if (stored === "open") details.open = true;
    if (stored === "closed" && !details.classList.contains("active-branch")) details.open = false;
    details.addEventListener("toggle", () => {
      localStorage.setItem("na-site-nav:" + key, details.open ? "open" : "closed");
    });
  });

  const input = document.getElementById("siteSearch");
  const box = document.getElementById("searchResults");
  if (!input || !box) return;
  let records = [];
  try {
    const response = await fetch(root + "assets/search-index.json");
    records = await response.json();
  } catch (_) {
    return;
  }
  const normalize = (value) => String(value || "").toLowerCase();
  const tokenize = (value) => normalize(value)
    .split(/[\s/\\._#\-:;()[\]{}"'`，。！？、；：（）【】《》<>]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const countOccurrences = (haystack, needle) => {
    if (!needle) return 0;
    let count = 0;
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      count += 1;
      index = haystack.indexOf(needle, index + Math.max(needle.length, 1));
    }
    return count;
  };
  const escapeText = (value) => String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const makeSnippet = (text, query, fallback) => {
    const raw = String(text || "");
    if (!raw) return fallback || "";
    const lower = raw.toLowerCase();
    const at = lower.indexOf(query);
    const center = at >= 0 ? at : 0;
    const start = Math.max(0, center - 42);
    const end = Math.min(raw.length, center + query.length + 76);
    return `${start > 0 ? "..." : ""}${raw.slice(start, end).trim()}${end < raw.length ? "..." : ""}`;
  };
  const scoreText = (rawText, query, terms) => {
    const text = normalize(rawText);
    if (!text) return null;
    const phraseAt = text.indexOf(query);
    const matchedTerms = terms.filter((term) => text.includes(term));
    if (phraseAt < 0 && matchedTerms.length === 0) return null;
    const phraseCount = countOccurrences(text, query);
    const termCount = matchedTerms.reduce((sum, term) => sum + countOccurrences(text, term), 0);
    const coverage = terms.length ? matchedTerms.length / terms.length : 0;
    const earliestTermAt = matchedTerms.reduce((best, term) => {
      const index = text.indexOf(term);
      return index >= 0 ? Math.min(best, index) : best;
    }, Number.MAX_SAFE_INTEGER);
    const earliest = phraseAt >= 0 ? phraseAt : earliestTermAt;
    const starts = phraseAt === 0 || matchedTerms.some((term) => text.startsWith(term));
    const exact = text === query;
    const score =
      (exact ? 260 : 0) +
      (phraseAt >= 0 ? 150 : 0) +
      (starts ? 70 : 0) +
      coverage * 80 +
      Math.min(phraseCount, 6) * 18 +
      Math.min(termCount, 12) * 4 +
      Math.max(0, 28 - Math.min(earliest, 28));
    return { score, phraseAt, earliest, matchedTerms, phraseCount, termCount };
  };
  const scoreRecord = (item, query, terms) => {
    const titleText = item.title || "";
    const titleMatch = scoreText(titleText, query, terms);
    if (titleMatch) {
      return {
        ...item,
        matchType: "title",
        matchLabel: "标题命中",
        score: 2000 + titleMatch.score,
        snippet: makeSnippet(titleText, query, item.path),
      };
    }
    const headingText = (item.headings || []).join(" ");
    const headingMatch = scoreText(headingText, query, terms);
    const bodyMatch = scoreText(item.text, query, terms);
    if (!headingMatch && !bodyMatch) return null;
    const contentScore = Math.max(
      bodyMatch ? bodyMatch.score : 0,
      headingMatch ? headingMatch.score * 0.8 + 40 : 0,
    );
    return {
      ...item,
      matchType: "content",
      matchLabel: "内容命中",
      score: 1000 + contentScore,
      snippet: makeSnippet(bodyMatch ? item.text : headingText, query, item.path),
    };
  };
  const renderHit = (item) => {
    const badgeClass = item.matchType === "title" ? "" : " search-hit-badge--content";
    return `<a class="search-hit" href="${root + item.path}">
      <div class="search-hit-head">
        <span class="search-hit-title">${escapeText(item.title)}</span>
        <span class="search-hit-badge${badgeClass}">${item.matchLabel}</span>
      </div>
      <div class="search-hit-snippet">${escapeText(item.snippet || item.path)}</div>
    </a>`;
  };
  input.addEventListener("input", () => {
    const raw = input.value.trim();
    const q = raw.toLowerCase();
    if (!q) {
      box.classList.remove("open");
      box.innerHTML = "";
      return;
    }
    const terms = tokenize(raw);
    const hits = records
      .map((item) => scoreRecord(item, q, terms))
      .filter(Boolean)
      .sort((a, b) =>
        b.score - a.score ||
        a.matchType.localeCompare(b.matchType) ||
        String(a.title || "").localeCompare(String(b.title || ""), "zh-CN"),
      )
      .slice(0, 12);
    box.innerHTML = hits.length
      ? hits.map(renderHit).join("")
      : `<div class="search-empty">没有匹配结果</div>`;
    box.classList.add("open");
  });
})();