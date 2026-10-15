<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 設計ドキュメント

- 変更前に[Design Overview](docs/design/00-overview.md)から対象領域と[設計課題](docs/design/99_課題.md)を確認してください。
- `docs/design/`は現行構造と設計判断、`docs/notes/`は過去の検討・記録です。業務用語は[GLOSSARY.md](GLOSSARY.md)を参照してください。
- 現行実装と合意した仕様を区別してください。文書とコードの差を見つけても、どちらかを無条件に正として上書きせず、未決事項と影響を記録してください。
- 責務・画面遷移・保存形式・AIへの情報の渡し方などを変更したら、対応する設計書と必要なテストも同じ変更で更新してください。詳細は一つの参照先に置き、関連文書からリンクしてください。
