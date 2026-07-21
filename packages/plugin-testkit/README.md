# GitTributary Plugin Testkit

`@gittributary/plugin-testkit` 是宿主与插件共享的测试契约。它提供宿主公开方法的稳定 case、默认返回值和可记录调用的 mock host，插件测试不需要重复手写一套宿主桩。

## 接入 Vitest

插件前端将 testkit 声明为开发依赖：

```json
{
  "devDependencies": {
    "@gittributary/plugin-testkit": "0.1.0",
    "vitest": "^4.1.10"
  }
}
```

仓库内插件还需在 `tsconfig.json` 中指向 testkit 源码，保证编辑器和类型检查可以解析：

```json
{
  "compilerOptions": {
    "paths": {
      "@gittributary/plugin-testkit": ["../../../packages/plugin-testkit/src/index.ts"]
    }
  }
}
```

`vitest.config.ts` 使用共享的 DOM 清理脚本：

```ts
export default defineProject({
  test: {
    environment: "jsdom",
    setupFiles: ["../../../packages/plugin-testkit/src/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

根目录的 `npm test` 会自动发现 `plugins/*/frontend/vitest.config.ts`。插件也可以在自己的目录运行 `npm test`。

## 使用宿主契约 case

`hostMethodCase` 按稳定 ID 读取典型输入与预期结果，适合验证插件到 Tauri 宿主的参数映射：

```ts
import { hostMethodCase } from "@gittributary/plugin-testkit";

const example = hostMethodCase("workspace.info.active");
expect(example.payload).toEqual({});
```

`hostMethodCases(method)` 返回一个方法的全部 case；`permissionDeniedCases()` 返回所有受权限控制方法的拒绝 case。完整数据位于 `src/host-methods.v1.json`，新增宿主公开方法时必须同时补充成功与错误样例。

## 使用 mock host

`createMockHost` 默认返回契约中定义的 canonical success result，也可以按方法覆盖 handler：

```ts
import { createMockHost } from "@gittributary/plugin-testkit";

const host = createMockHost({
  "store.get": () => ({ value: "dark" }),
});

await expect(host.invoke("store.get", { key: "theme" })).resolves.toEqual({ value: "dark" });
expect(host.calls).toEqual([{ method: "store.get", payload: { key: "theme" } }]);
```

## 官方与第三方插件边界

官方插件的前端测试由根 Vitest Projects 统一执行，Rust 后端由 `npm run test:plugins` 动态发现 `plugins/*/backend/Cargo.toml` 后执行。新增官方插件只需遵守这个目录结构，不需要修改根测试脚本。

第三方插件应在插件自己的 CI 或市场构建沙箱中运行测试。GitTributary 宿主运行插件时只校验 manifest、权限和协议兼容性，不执行插件仓库提供的测试脚本，避免把不受信任代码带入用户运行环境。
