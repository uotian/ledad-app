# ledad

[日本語](README.ja.md) | [English](README.md) | [中文（简体）](README.zh.md) | [Français](README.fr.md)

A Mac app that transcribes and translates meeting audio in real time, with AI assistance to help you understand and contribute. Follow the conversation, consult AI, and have your speaking drafts read aloud.

![ledad screen demo](docs/assets/ledad-demo.gif)

Screen demo using sample conversation data.

Built with Next.js 16, React 19, TypeScript, Python, Tauri 2, Swift, OpenAI API, Gemini API, and Apple SpeechTranscriber.

Next.js handles the interface and real-time audio streaming, while Python manages meeting data and AI processing. Tauri and Swift provide native macOS integration and audio capture.

## Features

- Audio input from the microphone, PC audio, or both
- Low-latency Live transcription and translation, plus Fixed results from reprocessing recorded audio
- Conversation topics and mentions, questions, and requests directed at you
- Context-aware AI consultation (Chat) and speaking drafts (Ask)
- Read reviewed drafts aloud, with pause and resume
- Generate reference text and a glossary from PDF, PowerPoint, images, and text documents
- Save meeting records and summaries, and export meeting minutes as Markdown
- Interface and speech in Japanese, English, Simplified Chinese, and French
- Light, dark, and system appearance modes, with a mocha color palette

## Requirements

- Apple Silicon Mac running macOS 26 or later
- An OpenAI API key (Gemini is optional)
- [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/) for PowerPoint conversion

## Setup

Download the Apple Silicon DMG from [Releases](https://github.com/uotian/ledad-app/releases/latest), open it, and copy `ledad.app` to Applications. The current DMG uses Apple Development signing and is not notarized; macOS may block it from opening.

To build locally from source, follow the steps below.

### Prepare the build environment

1. Install [Node.js](https://nodejs.org/en/download) 22 or later.
2. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and [Rust (rustup)](https://rust-lang.org/tools/install/) following their official instructions.
3. Install Xcode from the Mac App Store, open it once, and complete its initial setup.

### Get the source

```sh
git clone https://github.com/uotian/ledad-app.git
cd ledad-app
```

### Install dependencies

Run from the project root:

```sh
npm ci
```

### Prepare a signing certificate

Before the first build, prepare a development certificate for signing:

1. Open Xcode, go to Settings → Accounts, and add your Apple Account.
2. Select your Team and open Manage Certificates.
3. Click “+” and create an Apple Development certificate.

The certificate and private key are stored in your Mac’s login keychain and reused for subsequent builds.

### Build the app

Run from the project root:

```sh
npm run app:build
```

This creates `build/ledad.app`. Open it in Finder.

### Register API keys

Add your OpenAI API key in Settings → AI. To use Gemini too, enable the Gemini checkbox and add its key.

A custom OpenAI-compatible `base_url` can route text and audio processing to your gateway. While set, Live transcription uses Apple and Gemini is disabled. The gateway must support the existing models and API formats; see [connection requirements](docs/design/05-ai/02-connection.md).

### Allow audio access

When prompted at the first meeting start, allow microphone and system audio access. If access was denied, enable ledad in System Settings → Privacy & Security → Microphone / Screen & System Audio Recording, then restart the app if prompted.

## Usage

1. On Home, choose your audio source and languages, then click Start a meeting.
2. Follow the transcription and translation, consult AI, and create or read speaking drafts aloud.
3. Use Stop listening and Resume to control capture. Choose End to save and summarize the meeting.

## Notes

- OpenAI and Gemini API usage incurs charges. The displayed cost is an estimate.
- Meeting data is stored on your Mac. Audio, conversations, and documents are sent to external AI APIs as needed for processing.
- Listening stops automatically after 30 minutes by default (configurable). Choose Resume to continue.
- Sending generated speech through Zoom or similar apps requires separate audio-sharing setup.

## Documentation

[Design notes (Japanese, work in progress)](docs/design/00-overview.md)

## Changelog

See the [changelog](CHANGELOG.md).

## License

[MIT](LICENSE). Bundled fonts and icons retain their [font](public/licenses/Outfit-OFL.txt) and [icon](public/icons/providers/LICENSE) licenses.

This app is developed through vibe coding with Codex.
