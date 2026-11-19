# 前端自测：Vitest 单元测试与 TypeScript 构建

通过 Settled 直接运行前端工程质量门禁：
- `npm test`：执行 `src/` 下工具函数、Tauri API 包装层、UI 组件与 `App.tsx` 集成测试；
- `npm run build`：执行 `tsc && vite build` 校验严格模式类型检查；
- `coverage` 自定义分组：执行 `npm run test:coverage` 生成 V8 覆盖率统计表。
