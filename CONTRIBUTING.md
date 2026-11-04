# 开发与贡献

1. 使用 Node.js 22 或以上版本、Python 3；媒体编码测试需要 FFmpeg/ffprobe。
2. 运行 `npm test`、`npm run check` 和 `npm run build`。
3. 在 Chrome 扩展管理页加载 `extension/`；改动后重新加载。请仅用自己有权保存的音频验证。
4. 使用短分支和说明意图的提交，例如 `fix: keep folder permissions when preferences change`。
5. 提交前检查 `git diff --staged`。不要提交 Cookie、访问令牌、个人路径、目录句柄、真实短分享链接、音乐文件或截图里的账号信息。

单元测试不需要登录。涉及 QQ 页面、目录授权或转码行为的改动，还应记录真机验证和未覆盖的范围；不要把模拟测试通过写成真实下载通过。

目前自有代码尚未授予开源许可证；第三方组件的许可证独立适用，见 THIRD_PARTY_NOTICES.md。
