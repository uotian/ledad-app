# ledad

[日本語](README.ja.md) | [English](README.md) | [中文（简体）](README.zh.md) | [Français](README.fr.md)

一款实时转写和翻译会议音频的 Mac 应用，通过 AI 帮助你理解讨论并参与发言。你可以一边跟进对话，一边向 AI 咨询，或朗读准备好的发言稿。

![ledad 界面演示](docs/assets/ledad-demo.gif)

使用示例对话数据的界面演示。

使用技术：Next.js 16、React 19、TypeScript、Python、Tauri 2、Swift、OpenAI API、Gemini API、Apple SpeechTranscriber。

Next.js 负责界面和实时音频传输，Python 负责会议数据管理和 AI 处理。Tauri 和 Swift 负责 macOS 原生集成与音频采集。

## 主要功能

- 使用麦克风、电脑音频或两者混合输入
- 低延迟的 Live 转写和翻译，以及重新识别录音后生成的 Fixed 确定版
- 显示讨论主题，以及与你有关的提及、问题和请求
- 根据会议上下文向 AI 咨询（Chat）并生成发言稿（Ask）
- 朗读确认后的发言稿，支持暂停和继续
- 从 PDF、PowerPoint、图片和文本资料生成参考文与术语表
- 查看术语来源，并将文档和对话分析中的最多100个术语用作语音识别提示（Apple Live 除外）
- 保存会议记录和摘要，并导出 Markdown 会议纪要
- 支持日语、英语、简体中文和法语界面及语音
- 以咖啡摩卡色为基调，支持浅色、深色及跟随系统的外观模式

## 使用要求

- 搭载 Apple Silicon 的 Mac，macOS 26 或更高版本
- OpenAI API 密钥（Gemini 为可选项）
- [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/)（用于转换 PowerPoint 文件）

## 安装

### 安装应用

1. 下载 [Apple Silicon 版 v0.9.2](https://github.com/uotian/ledad-app/releases/download/v0.9.2/ledad_0.9.2_aarch64.dmg)（[SHA-256](https://github.com/uotian/ledad-app/releases/download/v0.9.2/ledad_0.9.2_aarch64.dmg.sha256)）。最新版本请查看 [Releases](https://github.com/uotian/ledad-app/releases/latest)。
2. 打开 DMG，将 `ledad.app` 拖入“应用程序”文件夹。
3. 从“应用程序”文件夹打开 `ledad.app`。

内含应用使用 Apple Development 签名；DMG 本身未签名、未公证，macOS 可能会阻止应用启动。

如果 macOS 阻止启动已确认来源的应用，请关闭警告，然后前往**系统设置 → 隐私与安全性 → 仍要打开**。[Apple 操作说明](https://support.apple.com/zh-cn/102445)。

### 注册 API 密钥

在“设置”→“AI”中添加 OpenAI API 密钥。如需同时使用 Gemini，请勾选 Gemini 选项并添加其密钥。

可指定兼容 OpenAI 的自定义 `base_url`，用于文本和音频处理。指定后，Live 转录固定使用 Apple，Gemini 被禁用。连接地址须支持现有模型名称和 API 格式，详见[连接要求](docs/design/05-ai/02-connection.md)。

### 允许音频访问

首次开始会议时，请允许访问麦克风和系统音频。如果此前拒绝了权限，请在系统设置 → 隐私与安全性 → 麦克风／屏幕与系统音频录制中允许 ledad，并在系统提示时重新启动应用。

## 使用方法

1. 在首页选择音频来源和语言，点击“开始会议”。
2. 查看转写和翻译，向 AI 咨询，生成并朗读发言稿。
3. 使用“停止听取”和“继续”控制听取，点击“结束”保存并总结会议。

## 数据处理

本应用在本地运行，应用保存的会议数据存储在您的 Mac 上。此外，Apple 的 SpeechTranscriber 在设备上进行转写，不会将识别用音频发送到 Apple 服务器。 [Apple 官方资料](https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition)

### 关于外部 AI 服务

处理所需的音频、对话和资料等会发送到 OpenAI API 或 Gemini API。接收方的数据处理遵循各服务的条款和设置。

#### 仅使用 OpenAI

- **训练和改进**：默认不会将 API 数据用于模型训练或改进。用户在 OpenAI 端明确同意共享数据的情况除外。
- **监控数据保留**：滥用监控日志通常最多保留 30 天。不过，根据 OpenAI 的设置和适用条件，可能可以关闭用于滥用监控的数据保留。

#### 同时使用 Gemini

使用 Gemini 的功能还适用以下说明。

- **训练和改进**：付费服务不会将输入和输出用于模型训练或改进。免费服务原则上会将其用于训练和改进。
- **监控数据保留**：输入、额外上下文和输出会为滥用监控等目的保留 55 天。付费服务也适用此项保留。

以上说明基于 2026 年 10 月 18 日核查的官方资料。最新条件请参阅下方链接。

- [OpenAI API：数据控制](https://developers.openai.com/api/docs/guides/your-data)
- [Gemini API：服务条款](https://ai.google.dev/gemini-api/terms)
- [Gemini API：滥用监控](https://ai.google.dev/gemini-api/docs/usage-policies)

如果设置了自定义接入地址（`base_url`），数据处理遵循该接入地址的规则。

## 注意事项

- 本应用通过 Codex 进行氛围编程（vibe coding）开发。
- 使用 OpenAI 和 Gemini API 会产生费用。界面显示的费用为估算值。
- 默认听取 30 分钟后自动停止，可在设置中修改。点击“继续”即可恢复。
- 如需在 Zoom 等应用中发送朗读音频，需另行配置音频共享。

## 文档

[设计资料（日语，编写中）](docs/design/00-overview.md)

## 更新日志

请参阅[更新日志](CHANGELOG.md)。

## 许可证

[MIT](LICENSE)
