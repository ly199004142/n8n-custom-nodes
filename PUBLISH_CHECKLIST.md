# 发布检查清单

## ✅ 已完成

- [x] 移除 fluent-ffmpeg 依赖
- [x] 实现直接调用 ffmpeg
- [x] 所有节点迁移完成
- [x] package.json 标记 selfHostedOnly: true
- [x] README 添加 Self-Hosted Only 警告
- [x] 添加 FFmpeg 安装说明
- [x] 构建成功
- [x] ESLint 检查通过（源代码）

## ⚠️ 预期的"失败"

- [ ] @n8n/scan-community-package 扫描失败 - **这是正常的！**
  - 原因：使用了 fs, path, child_process 模块
  - 解决方案：已标记 selfHostedOnly: true
  - 不影响发布到 npm

## 📝 发布步骤

1. 确认版本号（当前: 0.1.10）
2. 运行构建：`npm run build`
3. 运行 lint：`npm run lint`
4. 发布到 npm：`npm publish`
5. 验证发布：`npm view n8n-nodes-media-composition`

## 📋 发布后验证

- [ ] 在 npm 上可以看到新版本
- [ ] README 正确显示
- [ ] package.json 的 selfHostedOnly 标志存在
- [ ] 用户可以通过 `npm install n8n-nodes-media-composition` 安装

## 💡 重要说明

**扫描工具失败不影响发布！**

- selfHostedOnly 包允许使用受限模块
- 只要在文档中明确说明即可
- 很多 n8n 社区包都是 self-hosted only（如需要系统命令、数据库连接等的包）

