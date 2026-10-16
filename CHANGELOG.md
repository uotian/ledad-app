# Changelog

[English](CHANGELOG.md) | [日本語](CHANGELOG.ja.md)

## v0.8.1 — 2026-10-17

- Introduced a mocha light palette and a dark brown palette, with light, dark, and system appearance settings that are remembered across launches.
- Matched the macOS title-bar background to the sidebar in each appearance mode.
- Aligned home and meeting cards, refined sidebar and footer spacing, and set the transcription/AI-support card gap to 12px.
- Removed the layout switcher's outer border and transcription-row hover backgrounds.

This is a source-code release; notarized application downloads are not provided. Physical audio and external-provider end-to-end tests were not rerun for this release.

## v0.8.0 — 2026-10-17

- Added a custom OpenAI-compatible endpoint (`base_url`) for text, documents, Fixed transcription, and speech output. Live transcription uses Apple while a custom endpoint is set.
- Added OpenAI-only and optional Gemini modes, with selectable Live, Fixed, and speech providers and remembered voices for each provider.
- Added OpenAI Live transcription and speech output.
- Kept spoken drafts in the history so they can be read aloud again.
- Improved translation-direction and Fix countdown displays, empty meeting history, settings, API history, and the app icon.

Custom endpoints must support the existing model names and API formats. Gemini is disabled while a custom endpoint is set, and there is no automatic fallback. See [connection requirements](docs/design/05-ai/02-connection.md).

This is a source-code release; notarized application downloads are not provided. End-to-end tests with physical audio devices and corporate gateways were not rerun for this release.

## v0.1.0

Initial version with real-time meeting transcription, translation, and AI assistance.
