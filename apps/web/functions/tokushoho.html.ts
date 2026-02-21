export const onRequest: PagesFunction = async (context) => {
  // Cloudflare Pages の環境変数（Project Settings -> Environment variables）
  // 必須: TOKUSHOHO_RESPONSIBLE_NAME, TOKUSHOHO_PHONE
  // 任意: TOKUSHOHO_ADDRESS (改行区切り), TOKUSHOHO_EMAIL
  const responsibleName =
    (context.env.TOKUSHOHO_RESPONSIBLE_NAME as string | undefined) ?? "（未設定）";
  const phone =
    (context.env.TOKUSHOHO_PHONE as string | undefined) ?? "（未設定）";

  const addressRaw =
    (context.env.TOKUSHOHO_ADDRESS as string | undefined) ??
    "〒160-0022\n東京都新宿区新宿 1-36-2\n新宿第七葉山ビル 3F";

  const email =
    (context.env.TOKUSHOHO_EMAIL as string | undefined) ?? "fractal.filix@gmail.com";

  const addressHtml = nl2brEscaped(addressRaw);

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>特定商取引法に基づく表記</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                   "Hiragino Kaku Gothic ProN", "Noto Sans JP", Meiryo, sans-serif;
      line-height: 1.8;
      color: #222;
      background-color: #fff;
      margin: 0;
      padding: 24px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    h1 {
      font-size: 1.6rem;
      margin-bottom: 24px;
      border-bottom: 2px solid #eee;
      padding-bottom: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 12px 8px;
      vertical-align: top;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    th {
      width: 30%;
      font-weight: 600;
      background-color: #fafafa;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>特定商取引法に基づく表記</h1>

    <table>
      <tr>
        <th>販売事業者名</th>
        <td>Filix（個人事業主）</td>
      </tr>
      <tr>
        <th>運営責任者</th>
        <td>${escapeHtml(responsibleName)}</td>
      </tr>
      <tr>
        <th>所在地</th>
        <td>
          ${addressHtml}
        </td>
      </tr>
      <tr>
        <th>電話番号</th>
        <td>
          ${escapeHtml(phone)}<br>
          ※お問い合わせは原則メールにてお願いいたします。
        </td>
      </tr>
      <tr>
        <th>メールアドレス</th>
        <td>${escapeHtml(email)}</td>
      </tr>
      <tr>
        <th>販売価格</th>
        <td>各サービスページに記載の金額（税込）<br/>例）オンラインセッション30回パック 3,000円（税込）</td>
      </tr>
      <tr>
        <th>商品代金以外の必要料金</th>
        <td>なし（インターネット接続にかかる通信費等はお客様のご負担となります）</td>
      </tr>
      <tr>
        <th>支払方法</th>
        <td>クレジットカード決済（Stripe）</td>
      </tr>
      <tr>
        <th>支払時期</th>
        <td>ご注文時に決済が確定します。</td>
      </tr>
      <tr>
        <th>サービス提供時期</th>
        <td>決済確認後、原則として24時間以内に案内メールを送付し、サービス提供を開始します。</td>
      </tr>
      <tr>
        <th>提供方法</th>
        <td>オンライン（Zoom、Google Meet 等を使用）</td>
      </tr>
      <tr>
        <th>返品・キャンセルについて</th>
        <td>
          本サービスはデジタルコンテンツおよびオンライン提供の性質上、原則として返品・返金には応じておりません。<br>
          ただし、二重決済やシステム不具合等、明らかに当方の責に帰す事由がある場合には、個別に対応いたします。
        </td>
      </tr>
      <tr>
        <th>表現および商品に関する注意書き</th>
        <td>
          本サービスは自己理解・内省支援を目的としたものであり、医療行為、心理療法、診断行為を行うものではありません。<br>
          効果や成果を保証するものではありません。
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=UTF-8",
      // 念のため（キャッシュで古い内容が残るのを避ける）
      "cache-control": "no-store",
    },
  });
};

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// 改行区切りの住所を安全に <br> 化（各行は escape する）
function nl2brEscaped(s: string) {
  const lines = s.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  // 空行は落としすぎないほうが無難なのでそのまま扱う
  return lines.map((line) => escapeHtml(line)).join("<br>\n          ");
}
