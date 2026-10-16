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
- View glossary sources and use up to 100 terms from registered names, documents, and conversation analysis as speech-recognition hints (except Apple Live)
- Save meeting records and summaries, and export meeting minutes as Markdown
- Interface and speech in Japanese, English, Simplified Chinese, and French
- Light, dark, and system appearance modes, with a mocha color palette

## Requirements

- Apple Silicon Mac running macOS 26 or later
- An OpenAI API key (Gemini is optional)
- [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/) for PowerPoint conversion

## Setup

### Install the app

1. Download the Apple Silicon `.dmg` file from [Releases](https://github.com/uotian/ledad-app/releases/latest).
2. Open the DMG and drag `ledad.app` into the Applications folder.
3. Open `ledad.app` from Applications.

The bundled app is signed with Apple Development; the DMG itself is unsigned and not notarized, so macOS may block the app from opening.

If macOS blocks this trusted download, dismiss the alert and open **System Settings → Privacy & Security → Open Anyway**. See [Apple's instructions](https://support.apple.com/en-us/102445).

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

- This app is developed through vibe coding with Codex.
- OpenAI and Gemini API usage incurs charges. The displayed cost is an estimate.
- Meeting data is stored on your Mac. Audio, conversations, and documents are sent to external AI APIs as needed for processing.
- Listening stops automatically after 30 minutes by default (configurable). Choose Resume to continue.
- Sending generated speech through Zoom or similar apps requires separate audio-sharing setup.

## Documentation

[Design notes (Japanese, work in progress)](docs/design/00-overview.md)

## Changelog

See the [changelog](CHANGELOG.md).

## License

[MIT](LICENSE)
