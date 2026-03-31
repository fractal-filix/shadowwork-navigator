# β版 結合テスト計画

## 1. 目的

この計画は、β版 implementation 完了後に、staging の実接続環境で主要導線が成立することを確認するためのものです。

主目的:
- β配布前に致命的不具合を除去する
- 5人程度のβユーザーが踏む主要導線を事前に安定化する
- 本格性能試験の前に、即死級の詰まりだけを先に検出する

## 2. 前提

- 対象フェーズ: β版 implementation 完了後
- 実施環境: staging
- 外部サービス: Supabase, Stripe, Qdrant, AWS KMS, OpenAI を実接続で確認する
- 実施者: 主に開発者本人
- 参照: [staging_preflight_checklist.md](staging_preflight_checklist.md), [../implementation/task.md](../implementation/task.md), [../release-readiness/runbook_20260315_beta_release.md](../release-readiness/runbook_20260315_beta_release.md)

## 3. スコープ

含むもの:
- API と外部サービスをまたぐ結合確認
- Web から見た主要ユーザー導線の結合確認
- 最小限のシナリオ確認
- 軽い負荷スモーク

含まないもの:
- 網羅的な総合シナリオ試験
- 本格性能試験
- 大規模負荷試験
- 全異常系の網羅

## 4. テストレベル

### A. クリティカル結合テスト

目的:
- 壊れるとβ継続不可な境界を先に確認する

対象:
- 認証
- paid 判定
- Checkout Session 作成
- Stripe webhook 反映
- run 開始
- thread 開始
- thread chat
- 暗号化 message 保存
- message 一覧取得と復号
- RAG upsert/search
- thread close
- run restart

判定:
- 1件でも重大 NG があれば β配布を止める

### B. 体験結合テスト

目的:
- Web から見た導線が実用上使えることを確認する

対象:
- 新規ログイン直後の初回導線
- 未課金ユーザーの購入導線
- 課金反映後の初回利用
- 会話送信と次へ進む操作
- 過去 thread の履歴表示と復号
- 途中離脱後の再開

判定:
- 画面表示、画面遷移、主要 API 成功、データ反映の4点が成立する

### C. 薄いシナリオ試験

目的:
- β前に最低限の end-to-end の流れを通す

対象:
- 未課金ユーザーが購入して利用開始できる
- 課金済みユーザーが会話し、後で履歴を再読込できる
- RAG 付き会話が成立する

判定:
- happy path が途切れず最後まで通る

## 5. 実施順

1. ローカルの自動テスト基線を確認する
2. A を実施する
3. A が通ったら B を実施する
4. B の後に C を 2 から 3 本だけ実施する
5. 最後に軽い負荷スモークを実施する

時間不足時の優先順位:
1. A は削らない
2. B は最小セットを維持する
3. C は薄く削ってよい

## 6. 実施項目一覧

| ID | レベル | 観点 | 期待結果 |
| --- | --- | --- | --- |
| A-01 | A | Supabase ログイン + auth exchange | API セッションが確立し、その後の認証付き API が成功する |
| A-02 | A | paid 判定 | 未課金と課金済みで応答が正しく分かれる |
| A-03 | A | checkout session 作成 | Stripe Session が作成され user に紐付く |
| A-04 | A | Stripe webhook 反映 | paid フラグが更新され重複反映しない |
| A-05 | A | run start | active run が正しく作成される |
| A-06 | A | thread start | active thread が正しく作成または再利用される |
| A-07 | A | thread chat | OpenAI 応答が返る |
| A-08 | A | encrypted message 保存 | ciphertext と wrapped key を含めて保存できる |
| A-09 | A | thread messages 復号 | 履歴取得後に平文表示まで成立する |
| A-10 | A | rag chunks upsert/search | upsert した内容が検索文脈に使われる |
| A-11 | A | thread close | thread 状態が閉じる |
| A-12 | A | run restart | run の再開導線が成立する |
| B-01 | B | 新規ログイン直後 | dashboard の状態表示が正しい |
| B-02 | B | 未課金購入導線 | purchase へ誘導され、完了後に利用可能になる |
| B-03 | B | 初回会話導線 | app で送信、応答、保存が成立する |
| B-04 | B | 次へ進む操作 | close 後に次 thread へ遷移できる |
| B-05 | B | 履歴閲覧 | dashboard から過去 thread を復号表示できる |
| B-06 | B | 途中離脱後の再開 | 再アクセス時に state と履歴が整合する |
| C-01 | C | 購入から利用開始まで | 1ユーザーの happy path が最後まで通る |
| C-02 | C | 会話と履歴再読込 | 保存済み会話を後で読める |
| C-03 | C | RAG 付き会話 | 検索文脈が応答に反映される |

## 7. 補助ケース

異常系はシナリオ試験に混ぜず、補助ケースとして分けて実施する。

最低限見るもの:
- 認証切れ時に再ログイン導線へ戻せる
- Stripe webhook 未反映時に課金済み扱いにならない
- Qdrant 不達時に致命停止せず切り分け可能である
- KMS unseal 失敗時に履歴表示の失敗が把握できる

## 8. 軽い負荷スモーク

目的:
- 本格性能試験の代わりに、即死級ボトルネックを先に見つける

実施内容:
- 短時間に 2 から 5 回の chat を連続実行する
- message 保存を連続実行する
- Stripe webhook 反映に極端な遅延がないことを確認する
- rate limit の誤爆がないことを確認する

判定:
- タイムアウト、多発エラー、明らかな UI 詰まりがない

## 9. 合否基準

- A が全件 pass であること
- B の主要導線が pass であること
- C は 2 から 3 本の happy path が pass であること
- 軽い負荷スモークで重大な詰まりが出ないこと

保留可能なもの:
- βで致命にならない軽微 UI 問題
- 本格性能課題
- β後に改善可能な運用上の細部

## 10. 記録ルール

- 詳細手順は [test_cases.md](test_cases.md) に記載する
- 実施結果は今後 test_results.md に記録する
- 1ケースごとに開始条件、実施者、日時、結果、補足を残す
- fail 時は再現条件と切り分け先を必ず残す

## 11. 実施前チェック

- [x] [../implementation/task.md](../implementation/task.md) の implementation 完了状態を確認
- [x] [../release-readiness/runbook_20260315_beta_release.md](../release-readiness/runbook_20260315_beta_release.md) の事前確認項目と矛盾がない
- [x] [staging_preflight_checklist.md](staging_preflight_checklist.md) の確認対象が埋まっている
- [ ] staging の secrets / vars / D1 / 外部サービス設定が最新
- [x] β検証用ユーザーを使える
- [ ] 追加ユーザーが必要になった場合は統合テスト実施時に作成し、メールアドレスと用途を結果記録へ残す運用にする
- [x] 必要な外部管理画面へログインできる


