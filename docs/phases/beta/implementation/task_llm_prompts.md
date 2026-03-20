# LLM固定プロンプト集約タスク

作成日: 2026-03-17

## 背景

- OpenAI に渡す固定プロンプトが handler ごとに分散しており、修正箇所が追いづらい。
- まず prompt の定義を一箇所へ集約し、その後に文面修正を安全に行える状態を作る。
- 対象は API 側の固定プロンプトのみとし、OpenAI 呼び出し方式や Web 側 UI 文言は今回の対象外とする。

## 対象

- `apps/api/src/handlers/thread_chat.ts`
  - step 別 system prompt
  - next action reply
  - RAG context prompt
- `apps/api/src/handlers/llm_respond.ts`
  - 汎用応答の fixed system prompt
- `apps/api/src/handlers/llm_ping.ts`
  - health check 用 prompt

## 方針

1. `apps/api/src/lib/prompts.ts` を source of truth とする。
2. 各 handler の直書き prompt は削除し、共通モジュールを import する。
3. まずは挙動互換を維持したまま集約する。
4. 文面修正はこの集約後に同ファイルだけを触れば済む形にする。
5. health check 用 prompt は一般の対話 prompt と用途が違うため、同一ファイル内でも明示的に分けて扱う。

## 実装ステップ

- [x] 固定プロンプトの所在を全体調査する
- [x] 集約先を `apps/api/src/lib/prompts.ts` に決める
- [x] `thread_chat` の prompt builder を移す
- [x] `llm_respond` の fixed prompt を移す
- [x] `llm_ping` の health check prompt を移す
- [x] 意図した最終文面に差し替える
- [x] build と test で回帰確認する

## 確認ポイント

- `/api/thread/chat` の OpenAI input 構造が通常時 2件、RAG 時 3件のまま維持される
- `RAG context` の文面と件数制御が変わらない
- `/api/llm/respond` と `/api/llm/ping` が handler 直書きでなく共通 prompt を参照する
- 次回の prompt 修正が `apps/api/src/lib/prompts.ts` のみで完結する

## メモ

- 現時点では仕様書に最終文面が明記されていないため、まずは集約を先に行う。
- 文面修正時は integration test の期待値が文字列に依存していないか確認しながら進める。
- 2026-03-17: 元の ChatGPT プロジェクトの運用方針を反映し、shadowwork-navigator の `step1` を「初日の5質問」、`step2` を「二日目以降のジャーナル」として prompt に明示した。
- 2026-03-17: 初日の5質問、二日目以降の進行 ①〜⑤、段階を飛ばさない運用ルールを `apps/api/src/lib/prompts.ts` の定数として保持する形に変更した。
- 2026-03-20: `thread/start` の返却契約に `opener` を追加し、新規 thread 作成時のみ step に応じた開始文を返し、active thread 再利用時は `opener: null` を返す仕様にした。
- 2026-03-20: Web 側は `app.html` で「新規 thread かつ履歴空」の場合のみ `opener` を AI 発話として表示するようにし、`dashboard.html` は開始処理に専念する責務分離を明記した。
- 2026-03-20: 全体回帰（`pnpm -r --if-present test`）で Web 10件、API 97件、合計 107件がすべて pass を確認した。