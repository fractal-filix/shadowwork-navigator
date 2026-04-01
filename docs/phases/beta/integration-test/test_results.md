# β版 結合テスト結果

## 1. 使い方

この文書は [test_cases.md](test_cases.md) の実施結果を記録するためのテンプレートです。

判定ルール:
- pass: 期待結果を満たした
- fail: 期待結果を満たさなかった
- blocked: 前提不足や外部要因で実施できなかった

記録メモ:
- 追加ユーザーを作成した場合は、メールアドレスと用途を「使用ユーザー詳細」に残す

## 2. ケース別結果一覧

| ID | ケース | 実施日 | 実施者 | 環境 | 使用ユーザー | 使用ユーザー詳細 | 結果 | 証跡 | 補足 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-01 | Supabase ログイン + auth exchange |  |  | staging |  |  | not-run |  |  |
| A-02 | paid 判定 |  |  | staging |  |  | not-run |  |  |
| A-03 | checkout session 作成 |  |  | staging |  |  | not-run |  |  |
| A-04 | Stripe webhook 反映 |  |  | staging |  |  | not-run |  |  |
| A-05 | run start |  |  | staging |  |  | not-run |  |  |
| A-06 | thread start |  |  | staging |  |  | not-run |  |  |
| A-07 | thread chat |  |  | staging |  |  | not-run |  |  |
| A-08 | encrypted message 保存 |  |  | staging |  |  | not-run |  |  |
| A-09 | thread messages 復号 |  |  | staging |  |  | not-run |  |  |
| A-10 | rag chunks upsert/search |  |  | staging |  |  | not-run |  |  |
| A-11 | thread close |  |  | staging |  |  | not-run |  |  |
| A-12 | run restart |  |  | staging |  |  | not-run |  |  |
| B-01 | 新規ログイン直後 |  |  | staging |  |  | not-run |  |  |
| B-02 | 未課金購入導線 |  |  | staging |  |  | not-run |  |  |
| B-03 | 初回会話導線 |  |  | staging |  |  | not-run |  |  |
| B-04 | 次へ進む操作 |  |  | staging |  |  | not-run |  |  |
| B-05 | 履歴閲覧 |  |  | staging |  |  | not-run |  |  |
| B-06 | 途中離脱後の再開 |  |  | staging |  |  | not-run |  |  |
| C-01 | 購入から利用開始まで |  |  | staging |  |  | not-run |  |  |
| C-02 | 会話と履歴再読込 |  |  | staging |  |  | not-run |  |  |
| C-03 | RAG 付き会話 |  |  | staging |  |  | not-run |  |  |
| X-01 | 認証切れ |  |  | staging |  |  | not-run |  |  |
| X-02 | Stripe webhook 未反映 |  |  | staging |  |  | not-run |  |  |
| X-03 | Qdrant 不達 |  |  | staging |  |  | not-run |  |  |
| X-04 | KMS unseal 失敗 |  |  | staging |  |  | not-run |  |  |
| P-01 | 連続 chat |  |  | staging |  |  | not-run |  |  |
| P-02 | 連続 message 保存 |  |  | staging |  |  | not-run |  |  |
| P-03 | webhook 反映遅延 |  |  | staging |  |  | not-run |  |  |
| P-04 | rate limit 誤爆確認 |  |  | staging |  |  | not-run |  |  |