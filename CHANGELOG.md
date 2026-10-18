# Changelog

[English](CHANGELOG.md) | [日本語](CHANGELOG.ja.md)

## v0.9.1 — 2026-10-19

- Fixed translation handoff during partial Apple Live finalization to preserve displayed translations.
- Removed registered names and aliases from speech-recognition hints while retaining them for You mention detection. Conversation analysis now considers transcription variations using context and preserves original quotations.
- Silently discard late portions of mixed PC and microphone audio while continuing capture. Errors that prevent capture from continuing remain visible.
- Added data-handling information and official references to every README language.

Resolution with physical audio and mention-detection accuracy with real APIs remain unverified. The app uses Apple Development signing and is not notarized; macOS may block downloaded copies from opening.

## v0.9.0 — 2026-10-17

- Added a header glossary with a term count and a single source for each term: your registered names, documents, or conversation analysis, in that priority order.
- Combined registered names, document terms, and grounded terms from settled conversation into up to 100 speech-recognition hints. Conversation analysis selects existing and new terms for the remaining slots, balancing recognition difficulty and recent use.
- Changed OpenAI and Gemini Live connection renewal from nine to three minutes so updated vocabulary is applied more frequently.
- Refined card, form, and modal borders, selected-tab backgrounds, sidebar icons, settings buttons, and the loading indicator. Live and Fixed timestamps now use a subdued bold style.

The bundled app uses Apple Development signing; the Apple Silicon DMG itself is unsigned and not notarized, so macOS may block the app from opening. See the [installation instructions](README.md#setup). Term-selection quality and repeated three-minute renewal with physical audio and external providers were not validated for this release.

## v0.8.1 — 2026-10-17

- Introduced a mocha light palette and a dark brown palette, with light, dark, and system appearance settings that are remembered across launches.
- Matched the macOS title-bar background to the sidebar in each appearance mode.
- Aligned home and meeting cards, refined sidebar and footer spacing, and set the transcription/AI-support card gap to 12px.
- Removed the layout switcher's outer border and transcription-row hover backgrounds.

Apple Silicon DMG and source code are available on GitHub Releases. The DMG uses Apple Development signing and is not notarized; macOS may block it from opening. Physical audio and external-provider end-to-end tests were not rerun for this release.

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
