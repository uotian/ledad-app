# ledad

[日本語](README.ja.md) | [English](README.md) | [中文（简体）](README.zh.md) | [Français](README.fr.md)

![ledad 界面演示](docs/assets/ledad-demo.gif)

使用示例对话数据的界面演示。

一款实时转写和翻译会议音频的 Mac 应用，通过 AI 帮助你理解讨论并参与发言。你可以一边跟进对话，一边向 AI 咨询，或朗读准备好的发言稿。

使用技术：Next.js 16、React 19、TypeScript、Python、Tauri 2、Swift、OpenAI API、Gemini API、Apple SpeechTranscriber。

## 主要功能

- 使用麦克风、电脑音频或两者混合输入
- 低延迟的 Live 转写和翻译，以及重新识别录音后生成的 Fixed 确定版
- 显示讨论主题，以及与你有关的提及、问题和请求
- 根据会议上下文向 AI 咨询（Chat）并生成发言稿（Ask）
- 朗读确认后的发言稿，支持暂停和继续
- 从 PDF、PowerPoint、图片和文本资料生成参考文与术语表
- 保存会议记录和摘要，并导出 Markdown 会议纪要
- 支持日语、英语、简体中文和法语界面及语音

## 使用要求

- 搭载 Apple Silicon 的 Mac，macOS 26 或更高版本
- OpenAI 和 Gemini API 密钥
- LibreOffice

## 安装

请在自己的 Mac 上从源码构建应用。目前不提供经过公证的预构建应用下载。

### 准备构建环境

1. 安装 [Node.js](https://nodejs.org/zh-cn/download) 22 或更高版本。
2. 按照官方说明安装 [uv](https://docs.astral.sh/uv/getting-started/installation/) 和 [Rust（rustup）](https://rust-lang.org/tools/install/)。
3. 从 Mac App Store 安装 Xcode，打开一次并完成初始设置。

### 获取源码

```sh
git clone https://github.com/uotian/ledad-app.git
cd ledad-app
```

### 安装依赖

在项目根目录执行：

```sh
npm ci
```

### 准备签名证书

首次构建前，需要准备开发签名证书：

1. 打开 Xcode，进入 Settings → Accounts，添加你的 Apple 账户。
2. 选择自己的 Team，然后打开 Manage Certificates。
3. 点击“+”，创建 Apple Development 证书。

证书和私钥保存在 Mac 的登录钥匙串中。之后的构建会继续使用同一证书。

### 构建应用

在项目根目录执行：

```sh
npm run app:build
```

生成的应用位于 `build/ledad.app`，请在 Finder 中打开。

### 注册 API 密钥

在应用的“设置”中添加 OpenAI 和 Gemini API 密钥。

### 允许音频访问

首次开始会议时，请允许访问麦克风和系统音频。如果此前拒绝了权限，请在系统设置 → 隐私与安全性 → 麦克风／屏幕与系统音频录制中允许 ledad，并在系统提示时重新启动应用。

## 使用方法

1. 在首页选择音频来源和语言，点击“开始会议”。
2. 查看转写和翻译，向 AI 咨询，生成并朗读发言稿。
3. 使用“停止听取”和“继续”控制听取，点击“结束”保存并总结会议。

## 注意事项

- 使用 OpenAI 和 Gemini API 会产生费用。界面显示的费用为估算值。
- 会议数据保存在 Mac 本地。音频、对话和资料会根据处理需要发送到外部 AI API。
- 默认听取 30 分钟后自动停止，可在设置中修改。点击“继续”即可恢复。
- 如需在 Zoom 等应用中发送朗读音频，需另行配置音频共享。

## 文档

[使用与开发指南（日语）](docs/guide.md) · [设计资料（日语，编写中）](docs/design/00-overview.md)

## 更新日志

请参阅[更新日志](CHANGELOG.md)。

## 许可证

[MIT](LICENSE)。随附的字体和图标分别适用其[字体许可证](public/licenses/Outfit-OFL.txt)和[图标许可证](public/icons/providers/LICENSE)。

本应用通过 Codex 进行氛围编程（vibe coding）开发。
