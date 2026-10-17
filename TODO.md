# 明日のタスク一覧 & バグ改修手順書 (asdfbase)

明日すぐに作業を再開できるよう、本日発見されたバグの詳細と修正方針をまとめました。

---

## 📋 改修タスク一覧

| 重要度 | 項目 | 対象ファイル | 概要 |
| :--- | :--- | :--- | :--- |
| **🚨 Critical** | **VC（ボイスチャット）本格実装** | `frontend/src/App.tsx`<br>`backend/src/index.ts` | WebRTC PeerConnection、オファー/アンサー、ICE候補の交換と音声再生の実装 |
| **⚠️ High** | **メモ切替時のWS切断防止** | `frontend/src/App.tsx` | `useEffect` の依存配列から `selectedSlotIndex` を除外し、Refで参照する |
| **⚠️ High** | **未読ラインの修正** | `frontend/src/App.tsx` | 未読クリア・チャンネル移動時に `lastReadMessageIds` を更新し赤ラインを表示 |
| **⚠️ High** | **ボードのタッチ対応 & 線暴走防止** | `frontend/src/App.tsx` | タッチイベント（Chromebook/ペン用）追加 & キャンバス外マウス離脱処理 |
| **⚡ Medium** | **クリップボードのデバウンス** | `frontend/src/App.tsx` | 1文字ごとの過剰な HTTP PUT 送信に 500ms デバウンスを導入 |
| **⚡ Medium** | **メンバー専用メモスロットの固定化** | `backend/src/index.ts` | ユーザー追加・削除でスロットがズレないよう `10 + user.id` で一意固定 |
| **💡 Low** | **Monaco Editor 言語自動判定** | `frontend/src/App.tsx` | ファイル名/拡張子に応じてシンタックスハイライト言語を動的切替 |

---

## 🛠️ 各タスクの詳細と実装手順

### 1. 【Critical】VC（ボイスチャット）WebRTC 接続の実装
- **現状の課題**:
  - マイク音声を取得して SpeechRecognition 字幕を表示しているだけで、PeerConnection やシグナリング通信を行っておらず音声通話が成立しない。
- **改修内容**:
  1. バックエンドの既存 `WEBRTC_SIGNAL` イベントを活用。
  2. フロントエンドに `peersRef`（`Map<number, RTCPeerConnection>`）を用意。
  3. 新規参加者（`VC_USER_JOINED`）受信時、または自分が `VC_JOIN` した際に、既存VCメンバーとの間で WebRTC Offer / Answer を生成・交換。
  4. `ontrack` イベントで相手の音声ストリームを受信し、動的に `<audio autoPlay />` で再生。
  5. `VC_LEAVE` 時に該当 PeerConnection をクローズ・クリーンアップ。

---

### 2. 【High】メモスロット切り替え時の WebSocket 切断防止
- **現状の課題**:
  - `frontend/src/App.tsx` の 564行目: `useEffect(..., [token, selectedSlotIndex])` に `selectedSlotIndex` が含まれているため、スロットをクリックするたびに WebSocket が切断・再接続される。
- **改修内容**:
  1. `selectedSlotIndexRef = useRef(selectedSlotIndex)` を作成。
  2. スロット変更時に `selectedSlotIndexRef.current = selectedSlotIndex` を更新。
  3. `ws.onmessage` 内では `selectedSlotIndexRef.current` を参照。
  4. `useEffect` の依存配列を `[token]` のみに変更。

---

### 3. 【High】未読ライン機能の修正 (`setLastReadMessageIds`)
- **現状の課題**:
  - `const [lastReadMessageIds, setLastReadMessageIds]` が定義されているが、一度も呼び出されておらず、常に 0 のため未読赤ラインが出ない。
- **改修内容**:
  1. 別チャンネルに切り替える際、切り替え前のチャンネルの「最新メッセージID」を `lastReadMessageIds` に保存。
  2. または未読があるチャンネルを開いた際、その時点の最後の既読位置を保持したままメッセージを表示し、閲覧後に既読更新する。

---

### 4. 【High】ホワイトボードのタッチ・ペン対応 & マウス外れ防止
- **現状の課題**:
  - `<canvas>` に `onMouseDown`, `onMouseMove`, `onMouseUp` しかなく、Chromebook やスマホ・スタイラスペンで描画できない。
  - マウスをキャンバス外で離すと `isDrawing` が `true` のまま残り、キャンバスに戻ると勝手に線が引かれる。
- **改修内容**:
  1. `onTouchStart`, `onTouchMove`, `onTouchEnd` ハンドラを追加（`e.touches[0]` から座標取得）。
  2. `onMouseLeave` で描画を確定・終了するか、`window.addEventListener('mouseup')` でグローバルに `isDrawing` を解除。

---

### 5. 【Medium】クリップボード共有のデバウンス
- **現状の課題**:
  - `<textarea>` 入力時に 1文字ごとに `PUT /api/clipboard` を実行しており、秒間大量のリクエストが発生している。
- **改修内容**:
  1. `lodash.debounce` または `useRef` + `setTimeout` による 500ms デバウンスを導入。
  2. リアルタイム反映は WebSocket（`CLIPBOARD_UPDATED`）経由で行い、DB保存はデバウンスで安定化。

---

### 6. 【Medium】メンバー専用メモスロットのユーザーID一意固定化
- **現状の課題**:
  - `backend/src/index.ts` の `GET /api/notes` で、`ORDER BY id ASC` のループインデックス `uIdx` を使って `11 + uIdx` を割り当てているため、ユーザー削除時にスロット番号がズレて他人の内容を上書きするリスクがある。
- **改修内容**:
  1. 専用スロットの `slot_index` を `10 + u.id`（ユーザーID固定）に改修。
  2. ユーザーIDに基づいた永続スロットとすることで、ユーザー増減があっても内容がズレないようにする。

---

## 🚀 デプロイ手順（修正完了時）
```bash
# 1. バックエンド ビルド & VPS デプロイ
cd backend && npm run build
scp -P 62932 -i ~/id_ed25519_rds9 dist/index.js dist/db.js rds9@vps-gateway.sorahost.net:/home/rds9/services/asdfbase/backend/dist/
ssh -i ~/id_ed25519_rds9 -p 62932 rds9@vps-gateway.sorahost.net "pm2 reload asdfbase-backend"

# 2. フロントエンド ビルド & GitHub Push (Render自動反映)
cd ../frontend && npm run build
cd ..
git add .
git commit -m "fix: resolve VC webrtc signaling, ws disconnect on note switch, unread line, and canvas touch events"
git push origin main
```
