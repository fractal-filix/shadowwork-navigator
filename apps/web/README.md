## Web設定メモ（API通信/CORS/Cookie）

- 既定の API Base URL は `https://api.shadowwork-navigator.com` です（`pages/lib/client.js`）。
- Supabase クライアント設定は `SHADOWNAV_SUPABASE_URL` / `SHADOWNAV_SUPABASE_ANON_KEY` から読み取れます（`pages/lib/client.js`）。
- すべての API 呼び出しは `credentials: "include"` を付与して Cookie を送受信します。
- 一時的に API Base URL を上書きしたい場合は、ブラウザ Console で以下を実行してリロードします。

```js
localStorage.setItem("SHADOWNAV_API_BASE", "https://api.shadowwork-navigator.com");
location.reload();
```

- Supabase 設定をブラウザで一時的に上書きする場合:

```js
localStorage.setItem("SHADOWNAV_SUPABASE_URL", "https://bekltsvemtvbjxwrqvxg.supabase.co");
localStorage.setItem("SHADOWNAV_SUPABASE_ANON_KEY", "<SUPABASE_ANON_KEY>");
location.reload();
```

- 上書きを解除する場合:

```js
localStorage.removeItem("SHADOWNAV_API_BASE");
localStorage.removeItem("SHADOWNAV_SUPABASE_URL");
localStorage.removeItem("SHADOWNAV_SUPABASE_ANON_KEY");
location.reload();
```
