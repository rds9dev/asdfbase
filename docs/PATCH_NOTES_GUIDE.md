# パッチノート更新・管理ガイド (Patch Notes Guide)

asdfbase では、ユーザーにアップデート内容をわかりやすく伝えるため、データ駆動型のパッチノート管理システムを採用しています。

## 📁 関連ファイル

- **データ定義**: [`frontend/src/patchNotes.ts`](file:///home/yuto0926space/asdfbase/frontend/src/patchNotes.ts)
- **UI表示コンポーネント**: [`frontend/src/App.tsx`](file:///home/yuto0926space/asdfbase/frontend/src/App.tsx) 内の「その他」(`more`) > 「パッチノート」タブ
- **既読管理キー**: `localStorage.getItem('asdf_seen_patch_version')`

---

## 🚀 パッチノートの追加手順 (3ステップ)

新機能をリリースまたは修正した際は、以下の手順でパッチノートを追加します。

### ステップ 1: `frontend/src/patchNotes.ts` を開く

### ステップ 2: `LATEST_PATCH_VERSION` を新しいバージョンに更新する

```typescript
export const LATEST_PATCH_VERSION = 'v2.8.0'; // 例: 新しいバージョン番号
```

### ステップ 3: `PATCH_NOTES` 配列の先頭に新しいパッチノートオブジェクトを追加する

```typescript
export const PATCH_NOTES: PatchNote[] = [
  {
    version: 'v2.8.0',
    date: '2026-11-15', // YYYY-MM-DD
    title: '機能追加・改善の簡潔なタイトル',
    summary: '今回のアップデートの要約（1〜2文）',
    items: [
      {
        title: '項目名 1',
        description: '変更や改善の詳細な説明文'
      },
      {
        title: '項目名 2',
        description: '変更や改善の詳細な説明文'
      }
    ]
  },
  // ... 過去のパッチノート
];
```

---

## 💡 未読通知 & ハイライトの仕組み

- ユーザーが保持している `asdf_seen_patch_version` と `LATEST_PATCH_VERSION` が一致しない場合：
  - 画面下部（モバイル）および左ナビゲーションの **「その他」タブが光り (amber/cyan glow)、NEW バッジまたはドットが表示** されます。
  - 「その他」タブ内の「パッチノート」ボタンにも **NEW バッジ** が点灯します。
- ユーザーが「パッチノート」を表示すると、自動的に `localStorage` に最新バージョンが記録され、光と NEW バッジは即座に消去されます。
