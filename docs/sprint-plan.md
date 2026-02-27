# β版スプリント計画

作成日: 2026-02-26

## 目的（βで「使える」定義）
β版で最低限成立させる体験は以下。

1. 購入（Stripe Checkout）
2. ログイン（Supabase Auth → `/api/auth/exchange` → 自前JWT Cookie）
3. チャット（`/api/thread/chat` で平文中継）
4. 履歴確認（暗号文保存 → 復号して表示）
5. Step1/Step2 ナビ（run/threadの一覧・状態遷移）
6. AIガイド（RAGは最低限でよい。Qdrantを使って関連チャンクを注入）
7. セキュリティ（Cookie運用/CORS、Secrets管理、ログ抑制、権限制御）

## 重要な前提（設計として確定）
- **本文（メッセージ全文・カード）は封筒暗号で暗号化して保存**する。
  - 本文はDEK（共通鍵）で暗号化し、DEKはKEKで暗号化（ラップ）して保存する。
  - KEKはAWS KMS等の鍵管理基盤で保管・ローテーション・監査し、DBにKEKは保存しない。
  - APIの暗号メタは `wrapped_key`, `wrapped_key_alg`, `wrapped_key_kid` を含む。
- **Qdrant（ベクトルDB）を活かすため、検索用チャンクは本文と別系統で保存**する。
  - チャンクはやむを得ず平文を含みうる（本文と同等に機微情報として扱う）。
  - Qdrantは「検索インデックス」であり本文の正はD1（暗号文）。

**鍵管理方式（決定）**: 非対称ラップを採用します（クライアント生成DEKを公開鍵でラップして送信）。
- 理由: バックエンドが平文DEKに触れない運用が容易になり、管理者の誤読リスクを低減するため。

## スコープ外（βではやらない）
- 精度最適化（プロンプト改善の作り込み、評価基盤）
- 高度な鍵ローテ/再暗号化の完全自動化
- 退会・削除の完全運用（ただし削除伝播の設計/フックは入れる）

## PR分割

### PR#1 認証移行（Supabase Auth → exchange）
**狙い**: Memberstack依存を外し、Cookie JWT（SameSite=Strict）でAPIが呼べる状態にする。
- API: `/api/auth/exchange` を Supabase JWT 検証に置換
- API: 本番Secrets/Varsの棚卸し（MEMBERSTACK_* を撤去、SUPABASE_* を追加）
- Web: `credentials: 'include'` 統一、`user_id` クエリ廃止（JWT由来に統一）
**受入条件**: ログイン→exchange→保護APIが200で通る（paid未満は403等が正しく出る）

### PR#2 購入導線（Stripe Checkout）+ paid判定のUI統合
**狙い**: βで「購入→利用開始」が成立。
- Web: purchaseページをSupabaseログイン前提に更新（Memberstack削除）
- API: Checkout Session作成を現契約（JWTのsub）で確実に紐付け
- Web: `/api/paid` の反映、未paid時の導線（purchaseへ誘導）
**受入条件**: checkout→webhook→paid=true→run/startが通る

### PR#3 封筒暗号（鍵管理の最小実装）
**狙い**: 本文を暗号文のみで保存しつつ、復号に必要なDEKを安全に扱う。
- AWS: KMSキー作成（対称/非対称は実装方式に合わせて選択）
- API: KMS連携（署名付きリクエスト）
- API: DEK供給/ラップ/アンラップのためのエンドポイントを追加（例: `POST /api/crypto/dek/new`, `POST /api/crypto/dek/unseal`）
- API: `thread/message`, `context_card`, `step2_meta_card` で `wrapped_key*` の保存・返却を必須化
- D1: `database/DDL.sql` の封筒暗号メタカラムを適用（ローカル/ステージング）
**受入条件**: 1メッセージを暗号化して保存→履歴取得→復号して同一本文が表示できる

### PR#4 Web暗号実装（保存/表示/再読込）
**狙い**: UIが「暗号文API契約」に適合し、履歴が読める。
- Web: 暗号化（AES-GCM等）/復号実装、`wrapped_key*` も一緒に保存
- Web: `thread/messages` の暗号文を復号して表示（平文前提の実装を修正）
- Web: `context_card` / `step2_meta_card` の暗号化保存・復号編集
**受入条件**: app/dashboardで履歴表示が成立（暗号文がそのまま見えない）

### PR#5 Qdrant接続（インフラ/設定/最小クライアント）
**狙い**: WorkersからQdrantへ安全に接続し、collectionを用意。
- Qdrant: 環境（Qdrant Cloud等）を確定、APIキー/TLSで接続
- API: Qdrantクライアント実装（upsert/searchの最小）
- API: env追加（QDRANT_URL, QDRANT_API_KEY, QDRANT_COLLECTION等）
**受入条件**: 開発環境で upsert/search が疎通する

### PR#6 チャンク保存（平文チャンク + embedding）
**狙い**: 本文暗号化と独立に、検索用チャンクをQdrantへ保存できる。
- Web→API: チャンクのアップサートAPI追加（例: `POST /api/rag/chunks`）
- API: embedding生成（OpenAI embeddings等）→ Qdrant upsert
- Qdrant payload: `user_id`, `thread_id`, `message_id`, `chunk_no`, `text`（平文チャンク）
**受入条件**: 送ったチャンクが検索でヒットし、メタでフィルタ可能

### PR#7 RAG注入（AIガイド最低限）
**狙い**: `/api/thread/chat` でQdrant検索結果（チャンク）をプロンプトに注入。
- API: クエリ埋め込み → Qdrant search → 上位Kチャンクを prompt/context に追加
- API: user_idで必ず絞り込み（他ユーザー混入を防ぐ）
**受入条件**: 既知の内容を含むチャンクが応答に反映される（精度はβ品質で可）

### PR#8 Stepナビ/履歴/UXの最終整合
**狙い**: β必須の「ナビ」「履歴」が途切れず使える。
- Web: runs/threadsの遷移・一覧をJWT Cookie前提で整合
- Web: 保存失敗（pending_retry等）表示の最小反映
**受入条件**: Step1→Step2→履歴参照が一連で成立

### PR#9 セキュリティ仕上げ（β必須）
**狙い**: 事故りやすい箇所をβ前に塞ぐ。
- API: CORS allowlist / credentials / SameSite前提の確認
- API: ログ抑制（平文、チャンク平文、鍵素材を出さない）
- API: Rate limit / abuse対策（最低限）
- 運用: Secrets/Vars一覧更新、手順メモ
**受入条件**: Secrets漏えいリスクが設計どおり低い状態

### PR#10 テスト/リリースチェック
- tests: 既存integrationテストをSupabase/新契約に追従
- チェックリスト: βリリース手順（Workers/Pages/env/Stripe webhook/Qdrant/KMS）

## 依存関係（ざっくり）
- PR#2 は PR#1 に依存（ログイン状態の確立）
- PR#4 は PR#3 に依存（DEK/ラップのAPIが必要）
- PR#7 は PR#5/PR#6 に依存（Qdrantにデータが入る必要）

## βのDefinition of Done（最小）
- 認証: Supabaseでログインでき、Cookie JWTで保護APIが動く
- 課金: 購入→paid反映→利用開始が成立
- 暗号: 本文はD1に暗号文のみ。復号して履歴表示できる（封筒暗号メタ含む）
- RAG: Qdrantにチャンクが入り、`/api/thread/chat` が検索結果を注入する
- セキュリティ: CORS/credentials/Secrets/ログ抑制が設計どおり
