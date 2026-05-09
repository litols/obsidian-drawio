# Product Overview

`obsidian-drawio` は Obsidian と draw.io を連携させることを目的とした Web アプリ / プラグインプロジェクト。
現時点ではコードベースは Vite + React + TypeScript の初期テンプレート段階であり、プロダクト固有の機能はまだ実装されていない。

## Core Capabilities

プロジェクト名から想定される対象ドメイン:

- Obsidian Vault 内の draw.io ダイアグラム (`.drawio` / `.drawio.svg` / `.drawio.png`) の閲覧と編集
- ノートと図表の双方向リンクおよび埋め込み
- ローカルファースト (Obsidian Vault に直接保存) の永続化

> 実装が進んだ段階で、このセクションは実機能ベースに更新する。

## Target Use Cases

- Obsidian でナレッジ管理を行うユーザーが、ノート内に技術図・フロー図を埋め込みたい場面
- draw.io の表現力を Obsidian の Markdown ワークフローと統合したい場面

## Value Proposition

- Obsidian の **ローカルファースト / Markdown 中心** という性質を保ちつつ、draw.io の図表編集機能を取り込む
- 外部 SaaS に依存しない自己完結したダイアグラム編集体験

---

## Status (2026-05-10)

- リポジトリは初期化直後 (`initial commit` のみ)
- Spec / 機能要件は未策定 (`.kiro/specs/` 空)
- 次フェーズ: `/kiro-discovery` または `/kiro-spec-init` でスコープ確定

---
_Focus on patterns and purpose, not exhaustive feature lists_
