## Web設定メモ（API通信/CORS/Cookie）

- 既定の API Base URL は `https://api.shadowwork-navigator.com` です（`pages/lib/client.js`）。
- すべての API 呼び出しは `credentials: "include"` を付与して Cookie を送受信します。
- 一時的に API Base URL を上書きしたい場合は、ブラウザ Console で以下を実行してリロードします。

```js
localStorage.setItem("SHADOWNAV_API_BASE", "https://api.shadowwork-navigator.com");
location.reload();
```

- 上書きを解除する場合:

```js
localStorage.removeItem("SHADOWNAV_API_BASE");
location.reload();
```
