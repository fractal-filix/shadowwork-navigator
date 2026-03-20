# β版 結合テストケース

## 1. 使い方

この文書は [test_plan.md](test_plan.md) の各 ID に対応する詳細手順です。

運用ルール:
- 実施結果は別途 test_results.md に記録する
- 1ケースごとに pass / fail / blocked を判定する
- fail の場合は、どの境界で失敗したかを必ず残す

記録項目:
- 実施日
- 実施者
- 環境
- 使用ユーザー
- 結果
- 補足

## 2. 共通前提

- 環境は staging を使う
- Web の接続先は staging API を指している
- Supabase, Stripe, Qdrant, AWS KMS, OpenAI は staging 相当の実接続設定である
- β検証用に少なくとも未課金ユーザー 1 名、課金済みユーザー 1 名を用意する
- 必要に応じて D1, Stripe Dashboard, Cloudflare Dashboard, Qdrant Console, CloudTrail を確認できる

推奨ユーザー:
- user-free: 未課金確認用
- user-paid: 課金済み確認用

## 3. A. クリティカル結合テスト

### A-01 Supabase ログイン + auth exchange

目的:
- Supabase ログイン後に API セッションが確立することを確認する

事前条件:
- user-free または user-paid が Supabase に存在する

手順:
1. index.html から対象ユーザーでログインする
2. dashboard へ遷移する
3. /api/paid, /api/thread/state など認証必須 API が呼ばれていることを確認する
4. ブラウザ開発者ツールで Cookie が設定されていることを確認する

期待結果:
- ログイン後に dashboard が表示される
- 認証必須 API が 401 にならない
- API 用 Cookie が設定される

証跡:
- dashboard 表示
- Network の /api/auth/exchange と後続 API 応答

### A-02 paid 判定

目的:
- 未課金と課金済みで paid 判定が正しく分かれることを確認する

事前条件:
- user-free は未課金、user-paid は課金済みである

手順:
1. user-free でログインする
2. dashboard で利用不可または purchase 導線が出ることを確認する
3. ログアウトし user-paid でログインする
4. dashboard で利用可能状態になることを確認する

期待結果:
- user-free は paid=false 相当の表示になる
- user-paid は paid=true 相当の表示になる

証跡:
- dashboard の状態表示
- 必要に応じて /api/paid の応答

### A-03 checkout session 作成

目的:
- 未課金ユーザーが Stripe Checkout Session を作成できることを確認する

事前条件:
- user-free でログイン済み

手順:
1. purchase.html へ遷移する
2. 決済ページへ ボタンを押す
3. /api/checkout/session の応答を確認する
4. Stripe の checkout URL へ遷移することを確認する

期待結果:
- checkout session 作成 API が成功する
- Stripe checkout へ遷移する
- client_reference_id が対象ユーザーに紐付く

証跡:
- Network の /api/checkout/session
- Stripe Dashboard の session 情報

### A-04 Stripe webhook 反映

目的:
- 決済完了後に paid フラグが更新されることを確認する

事前条件:
- A-03 が成功している

手順:
1. Stripe テスト決済を完了する
2. Stripe Dashboard で webhook delivery 成功を確認する
3. purchase.html に戻り 支払い確認 を押す
4. dashboard へ進めることを確認する
5. 同じイベントを再送できる場合は再送し、重複反映しないことを確認する

期待結果:
- webhook が成功する
- paid フラグが更新される
- 重複イベントで二重反映しない

証跡:
- Stripe Dashboard の delivery 結果
- purchase.html の状態表示
- 必要に応じて D1 の user_flags / stripe_webhook_events

### A-05 run start

目的:
- 課金済みユーザーの active run が作成されることを確認する

事前条件:
- user-paid でログイン済み

手順:
1. dashboard を開く
2. 開始導線から run を開始する
3. /api/run/start の応答を確認する
4. 直後に /api/thread/state で active run を確認する

期待結果:
- run start が成功する
- active run が 1 件作成される

証跡:
- Network の /api/run/start
- dashboard 表示または /api/thread/state 応答

### A-06 thread start

目的:
- active thread が作成または再利用されることを確認する

事前条件:
- active run が存在する

手順:
1. app.html を開く
2. 初回読み込みで /api/thread/start または /api/thread/state が動くことを確認する
3. 現在の thread 情報が表示されることを確認する
4. 再読込して同じ active thread が再利用されるか確認する

期待結果:
- thread start が成功する
- 新規または既存 thread が正しく扱われる

証跡:
- app.html の表示
- Network の /api/thread/start, /api/thread/state

### A-07 thread chat

目的:
- OpenAI を使った応答生成が成立することを確認する

事前条件:
- active thread が存在する

手順:
1. app.html で短いメッセージを送信する
2. /api/thread/chat の応答を確認する
3. AI 応答が画面に表示されることを確認する

期待結果:
- thread chat が成功する
- AI 応答が返る

証跡:
- app.html のログ表示
- Network の /api/thread/chat

### A-08 encrypted message 保存

目的:
- Web 暗号化後の message 保存が成立することを確認する

事前条件:
- A-07 の会話が可能である

手順:
1. app.html でメッセージを送信する
2. /api/crypto/kms_public_key の取得を確認する
3. /api/thread/message の送信ペイロードに ciphertext と wrapped_key 系が含まれることを確認する
4. /api/thread/message が成功することを確認する

期待結果:
- KMS 公開鍵取得が成功する
- 暗号化済みペイロードで保存 API が成功する

証跡:
- Network の /api/crypto/kms_public_key
- Network の /api/thread/message

### A-09 thread messages 復号

目的:
- 保存済み履歴が取得され、Web 側で復号表示できることを確認する

事前条件:
- 保存済みメッセージが 1 件以上ある

手順:
1. app.html を再読込する
2. /api/thread/messages の応答を確認する
3. /api/crypto/dek/unseal が必要回数だけ呼ばれることを確認する
4. 復号済み平文が画面に表示されることを確認する

期待結果:
- messages 取得が成功する
- unseal を経て平文表示できる

証跡:
- app.html のログ表示
- Network の /api/thread/messages, /api/crypto/dek/unseal

### A-10 rag chunks upsert/search

目的:
- RAG 用チャンク登録と検索が成立することを確認する

事前条件:
- Qdrant が利用可能である

手順:
1. /api/rag/chunks を使って識別しやすいテキストを登録する
2. 登録後、その内容に関連する質問を app.html から送信する
3. 応答内容またはログから、登録した文脈が使われていることを確認する

期待結果:
- rag chunks upsert が成功する
- 後続の応答で関連文脈が反映される

証跡:
- Network の /api/rag/chunks
- 関連質問時の /api/thread/chat 応答

### A-11 thread close

目的:
- 現在の thread を閉じられることを確認する

事前条件:
- active thread が存在する

手順:
1. app.html で 次へ を押す、または close 導線を実行する
2. /api/thread/close の応答を確認する
3. state を再取得して、閉じた thread が active でないことを確認する

期待結果:
- thread close が成功する
- thread 状態が閉じる

証跡:
- Network の /api/thread/close
- 直後の /api/thread/state

### A-12 run restart

目的:
- run 再開導線が成立することを確認する

事前条件:
- run restart の対象状態を作れている

手順:
1. dashboard から再開導線を選ぶ
2. /api/run/restart の応答を確認する
3. 再開後に app へ戻り継続利用できることを確認する

期待結果:
- run restart が成功する
- 再開後の state が整合する

証跡:
- Network の /api/run/restart
- dashboard と app の表示

## 4. B. 体験結合テスト

### B-01 新規ログイン直後

目的:
- ログイン直後の dashboard 状態が理解可能であることを確認する

手順:
1. index.html からログインする
2. dashboard に遷移する
3. member 表示、状態表示、主要ボタンが矛盾なく表示されることを確認する

期待結果:
- ログイン直後の状態が読める
- 次アクションが分かる

### B-02 未課金購入導線

目的:
- 未課金ユーザーが迷わず purchase へ進めることを確認する

手順:
1. user-free でログインする
2. dashboard から purchase へ遷移する
3. purchase.html の手順、ボタン状態、支払い確認導線を確認する

期待結果:
- 購入導線が自然につながる
- ログイン不足や paid 未反映時の表示が破綻しない

### B-03 初回会話導線

目的:
- 初回会話の送信、応答、保存が一連で成立することを確認する

手順:
1. user-paid で dashboard から app を開く
2. 初回メッセージを送信する
3. AI 応答が返り、再読込後も残ることを確認する

期待結果:
- 会話開始が止まらない
- 保存と再表示までつながる

### B-04 次へ進む操作

目的:
- 現在 thread を終えて次へ進む導線が自然に動くことを確認する

手順:
1. app.html で会話中の状態を作る
2. 次へ を押す
3. 次の thread または dashboard への遷移結果を確認する

期待結果:
- 閉じる処理と次導線が破綻しない

### B-05 履歴閲覧

目的:
- dashboard から過去会話を読めることを確認する

手順:
1. 会話済み run と thread を作っておく
2. dashboard の履歴ビューアから run と thread を選ぶ
3. messages が復号表示されることを確認する

期待結果:
- 過去会話が読める
- 履歴導線が app 依存になっていない

### B-06 途中離脱後の再開

目的:
- 途中離脱後に再開しても state と履歴が崩れないことを確認する

手順:
1. 会話途中でブラウザを閉じる、または別タブで再アクセスする
2. dashboard または app を開き直す
3. active run / active thread / 既存履歴が整合していることを確認する

期待結果:
- 再開時に二重作成や表示崩れがない

## 5. C. 薄いシナリオ試験

### C-01 購入から利用開始まで

目的:
- 未課金ユーザーが購入後に利用開始できる happy path を通す

手順:
1. user-free でログインする
2. purchase 導線へ進む
3. Stripe 決済を完了する
4. dashboard に戻り利用可能状態を確認する
5. app を開いて会話開始できることを確認する

期待結果:
- 購入から利用開始まで途切れない

### C-02 会話と履歴再読込

目的:
- 課金済みユーザーが会話し、後で履歴を再読込できる happy path を通す

手順:
1. user-paid でログインする
2. app で会話を 1 往復以上行う
3. ページを再読込する
4. 履歴が復号表示されることを確認する
5. dashboard の履歴ビューアでも同じ会話を確認する

期待結果:
- 保存、再読込、履歴閲覧が一貫する

### C-03 RAG 付き会話

目的:
- RAG 文脈投入を含む happy path を通す

手順:
1. /api/rag/chunks に識別しやすいテキストを登録する
2. その内容に対応する質問を app で送信する
3. 応答に登録内容が反映されることを確認する

期待結果:
- RAG 登録と利用が一連で成立する

## 6. 補助ケース

### X-01 認証切れ

手順:
1. ログイン後にセッション切れ状態を作る
2. 認証必須 API を叩く操作を行う

期待結果:
- 破綻せず再ログイン導線へ戻せる

### X-02 Stripe webhook 未反映

手順:
1. 決済直後に webhook 未反映相当の状態を確認する
2. purchase.html の支払い確認を行う

期待結果:
- paid 扱いに誤判定されない
- 切り分け可能な状態表示になる

### X-03 Qdrant 不達

手順:
1. Qdrant 接続不良相当の状態で関連質問を送る

期待結果:
- 致命停止せず、障害箇所を切り分けできる

### X-04 KMS unseal 失敗

手順:
1. 復号時に unseal 失敗相当の状態を作る
2. 履歴表示を試みる

期待結果:
- 履歴表示失敗が把握できる
- 平文や鍵素材は漏れない

## 7. 軽い負荷スモーク

### P-01 連続 chat

手順:
1. 同一ユーザーで短時間に 2 から 5 回 chat を送る

期待結果:
- 多発エラーや極端な遅延がない

### P-02 連続 message 保存

手順:
1. 短時間に複数回メッセージを保存する

期待結果:
- 保存失敗や順序破綻がない

### P-03 webhook 反映遅延

手順:
1. 決済後、purchase.html の確認導線を数回試す

期待結果:
- 極端な遅延がなければ最終的に paid になる

### P-04 rate limit 誤爆確認

手順:
1. 通常利用の範囲で chat と state 取得を繰り返す

期待結果:
- 通常利用で rate limit が過剰発火しない