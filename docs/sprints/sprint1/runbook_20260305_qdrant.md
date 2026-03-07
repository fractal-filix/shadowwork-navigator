# Qdrant (Qdrant Cloud) アカウント作成手順

作成日: 2026-03-05

目的: Qdrant Cloud にアカウント/クラスタを作成し、APIキーとコレクションを用意して Workers から接続できることを確認する。

手順:

1. Qdrant Cloud にサインアップ
   - https://cloud.qdrant.io/ にアクセスしてアカウントを作成。
   - 必要なら組織/チーム名を設定。

2. クラスタ（Project/Cluster）作成
   - リージョンとプラン（評価用は最小プランで可）を選択。
   - TLS (HTTPS) が有効になっていることを確認。

3. API キー発行
   - ダッシュボードの「API Keys」から新しいキーを作成。
   - 権限は最小限で良い（upsert/search を許可するキー）。
   - 発行したキーは一度しか表示されないため安全な場所に保存。

4. Collection 作成
   - Embedding 次元（例: 1536 / 使用する埋め込みモデルに合わせる）を設定。
   - Distance: cosine など用途に合わせて選択。
   - Payload schema に必要なフィールド（user_id, thread_id, message_id, chunk_no, text 等）を想定しておく。

5. 接続情報の確認
   - Qdrant のエンドポイント URL（例: https://<cluster>.<region>.qdrant.cloud）をメモ。
   - 発行した API_KEY をメモ。

6. Workers 側の TLS 要件確認
   - Workers から HTTPS エンドポイントに接続できること（通常は OK）。
   - サーバ証明書が自動的に有効であれば追加の設定は不要。

7. 簡易疎通テスト（curl 例）
   - Collection を作成したら、簡単な search を実行して疎通確認。
   - 例:

```bash
curl -s -X POST "<QDRANT_URL>/collections/<COLLECTION>/points/search" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <QDRANT_API_KEY>" \
  -d '{"vector": [0,0,0,...], "top": 1}'
```

8. 環境変数/Workers Secrets に登録する値（例）
   - `QDRANT_URL` = https://...（コレクション操作ベースのURL）
   - `QDRANT_API_KEY` = 発行したAPIキー
   - `QDRANT_COLLECTION` = 作成したcollection名

9. 実装メモ
   - Embedding の次元は OpenAI 等の埋め込みモデルに合わせること。
   - Qdrant の upsert/search を行う最小クライアントを `apps/api/lib` に実装する（別タスク）。
   - セキュリティ: APIキーは Workers Secrets にのみ保存し、ログに出力しない。

次のアクション:
 - Workers から接続するサンプルスクリプトを作成して疎通確認（別タスク）
