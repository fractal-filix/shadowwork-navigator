# SQLコード規約

## 0. 前提（対象DB/方言）

- 本規約は **（CloudflareのD1）** を前提とする
- DB方言差がある構文（日時演算、真偽値、JSON、UPSERT等）は、利用箇所で方言を明記する

## 1. フォーマット

- 予約語/集約/関数名は大文字、その他は小文字
- インデントは4スペース
- 文末は `;` で終える
- `SELECT` 句の列挙は「末尾カンマ」を許可する（差分を小さくするため）
- キーワード後の改行について
  - FROM の直後は改行してテーブル名
  - JOIN は同一行（LEFT JOIN orders）で、ON は改行
  - WHERE の条件は AND を行頭にして縦に揃える

例:

```sql
SELECT
    users.user_id,
    users.email,
    COUNT(orders.order_id) AS order_count
FROM
    users
LEFT JOIN orders
    ON orders.user_id = users.user_id
WHERE
    users.is_active = TRUE
AND
    users.email IS NOT NULL
GROUP BY
    users.user_id,
    users.email
ORDER BY
    order_count DESC;
```

---

## 2. 命名規則

- snake_case を使用（例: `user_id`, `created_at`）
- テーブル名は複数形（例: `users`, `orders`）
- 主キーは `id` または `{table}_id`
- 外部キーは参照先に合わせる（例: `user_id`, `order_id`）
- ブール値は `is_` / `has_` 接頭辞（例: `is_active`, `has_paid`）
- 日時は `_at` / `_on`（例: `created_at`, `deleted_at`, `paid_on`）

---

## 3. 句の順序（読みやすさ）

原則として以下の順序にする:

1. `WITH`（CTE）
2. `SELECT`
3. `FROM`
4. `JOIN ... ON`
5. `WHERE`
6. `GROUP BY`
7. `HAVING`
8. `ORDER BY`
9. `LIMIT` / `OFFSET`

---

## 4. エイリアス

- 原則フルネーム、衝突/冗長時のみ意味が通るエイリアス
- 基本的に単語を省略しない
  - 避けるべき例：users -> u, usrs, order -> o, odr
  - 許容される例：users, user_typesをJOINする際、users（そのまま）, types（別名）とするなど意味が分かる場合
- 計算結果や集約関数を使用したカラムは必ずエイリアスを使用する（意味が分かりにくくなるため）
- `AS` は 明示する
- 予約語/集約/関数名をエイリアスとして使用しない

---

## 5. JOIN

- `JOIN` の種類を明示（`INNER JOIN`, `LEFT JOIN` など）
- `ON` 条件は **JOIN直下に複数行で**書く
- 不要な多重JOINを避ける（事前にCTEで整理するのも可）

---

## 6. WHERE / 条件式

- 条件は **1行1条件**（`AND`/`OR` で揃える）
- `OR` が混ざる場合は **括弧で優先順位を明確化**
- `NULL` 判定は `IS NULL` / `IS NOT NULL`
- 日付・数値範囲は `BETWEEN` より `>=` / `<` を好む（境界が明確）

## 6.1. 安全性（パラメータ化）

- アプリケーションから発行するSQLは、可能な限り **プレースホルダ** を使用して値をバインドする（SQLインジェクション対策）
- 動的に列名/テーブル名を組み立てる必要がある場合は、許可リスト（ホワイトリスト）で制限する

## 6.2. SELECT

- 本番相当のクエリでは原則 `SELECT *` を避け、必要な列を明示する（スキーマ変更の影響範囲を限定するため）

## 7. 集計（GROUP BY）

- `GROUP BY` は **列名を明示**（位置指定 `GROUP BY 1,2` は避ける）

---

## 8. CTE（WITH）

- 複雑なクエリは **CTEで段階分割**して読む順に並べる
- CTE名は処理内容が分かる名前（例: `active_users`, `orders_30d`）
- 使い捨てのサブクエリよりCTEを優先（DBの最適化事情がある場合は例外）

---

## 9. DDL（テーブル定義）

- カラムは次の順序が読みやすい:
  1. 主キー
  2. 外部キー
  3. 業務カラム
  4. フラグ類
  5. 監査カラム（`created_at`, `updated_at`, `deleted_at` など）
- 可能なら `NOT NULL` を基本にし、`NULL` を許す理由を明確にする
- デフォルト値は意図がある場合のみ付ける（暗黙の挙動を増やさない）
- インデックスは「なぜ必要か」が分かるように命名・整理する

---

## 10. コメント

- 「何をしているか」より **なぜ必要か** を書く
- バグ回避や仕様由来の制約はコメントで残す

---

## 11. 自動整形（任意）

- 可能なら `sqlfluff` 等のフォーマッタ/リンタを導入し、CIでチェックする
- ただし、まずはこのドキュメントに沿って手動で統一してもOK
