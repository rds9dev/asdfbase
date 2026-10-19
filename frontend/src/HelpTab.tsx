// ヘルプ: すべての機能の説明 (目次つき)
import React, { useRef, useState } from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';

interface Section {
  id: string;
  title: string;
  body: React.ReactNode;
}

const K = ({ children }: { children: React.ReactNode }) => <kbd className="kbd">{children}</kbd>;

const SECTIONS: Section[] = [
  {
    id: 'basics',
    title: '画面の見かた',
    body: (
      <>
        <p>上のバーの左側でタブ (チャット・メモ・AI・提出物・ボード・その他・設定・ヘルプ) を切り替えます。スマホでは画面の下にタブが並びます。</p>
        <p>右側には「今の授業」「天気」「時計」があります。マウスを乗せると概要、クリックすると詳しい画面が開きます。</p>
        <ul>
          <li><b>今の授業</b>: 登校前 / 朝の会 / ○限 / 休み時間 / 昼休み / 帰りの会 / 放課後 を表示。クリックで時間割。</li>
          <li><b>天気</b>: 高松市の天気。クリックで1時間ごとの予報と週間予報。</li>
          <li><b>時計</b>: クリックで月のカレンダーと予定。</li>
        </ul>
        <p>開いていたタブとチャンネルは、リロードしても同じものが開きます。</p>
      </>
    ),
  },
  {
    id: 'chat',
    title: 'チャット',
    body: (
      <>
        <h4>送信</h4>
        <ul>
          <li><K>Enter</K> で送信、<K>Shift</K>+<K>Enter</K> で改行。日本語の変換中の Enter では送信されません。</li>
          <li>画像は <kbd className="kbd">Ctrl</kbd>+<kbd className="kbd">V</kbd> で貼り付け、ドラッグ＆ドロップ、または画像ボタンで添付できます。入力欄の上にプレビューが出て、メッセージと一緒に送られます (×で外せます。自動で圧縮されます)。画像をクリックすると拡大・保存できます。</li>
          <li>送信に失敗したメッセージは「再送」できます。オフラインから戻った時は自動で再送します。</li>
        </ul>
        <h4>メンションとチャンネルの補完</h4>
        <ul>
          <li><code>@</code> を打つとメンバーの候補、<code>#</code> を打つとチャンネルの候補が出ます。</li>
          <li><K>Tab</K> か <K>↑</K><K>↓</K> で候補を選び、<K>Enter</K> で決定します。<K>Esc</K> で閉じます。</li>
          <li>正しく入力できたメンションは入力欄で色付きになるので、送る前に確認できます。</li>
          <li><code>@everyone</code> は全員への通知、<code>@gemini</code> は AI への質問です (下の「@gemini」参照)。</li>
          <li>メッセージ内の <code>#チャンネル名</code> はクリックでそのチャンネルへ移動できます。右のメンバー一覧の名前を押してもメンションを入力できます。</li>
        </ul>
        <h4>メッセージの操作</h4>
        <p>メッセージにマウスを乗せると、返信・リアクション・ピン留め・リンクのコピー・編集・削除のボタンが出ます。</p>
        <ul>
          <li>入力欄が空の時に <K>↑</K> を押すと、自分の直前のメッセージを編集できます。</li>
          <li>削除する時は確認が出ます。削除したメッセージは設定の「監査ログ」から復元できます。</li>
        </ul>
        <h4>未読とメンション</h4>
        <ul>
          <li>未読があるチャンネルは白く太字になり、左に白い点が付きます。</li>
          <li><b>赤い数字</b>は自分宛て (自分へのメンション・返信・@everyone) の数だけです。ブラウザのタブのアイコンにも数字が出ます。</li>
          <li>チャンネルを開いた時、まだ読んでいない所に赤い「新着」線が出ます。</li>
        </ul>
        <h4>そのほか</h4>
        <ul>
          <li>誰かが入力している時は、入力欄の上に「○○ が入力中…」と出ます。</li>
          <li>虫めがねボタンで、表示中のチャンネルのメッセージを検索できます。</li>
          <li>左右の矢印ボタンでチャンネル一覧・メンバー一覧を表示/非表示にできます。</li>
          <li>接続状態のバッジをクリックすると接続設定を開きます。</li>
        </ul>
      </>
    ),
  },
  {
    id: 'gemini',
    title: '@gemini (チャットで AI に質問)',
    body: (
      <>
        <p>メッセージに <code>@gemini</code> を含めると、AI がそのチャンネルの直近の会話の流れを読んだうえで返信します。</p>
      </>
    ),
  },
  {
    id: 'memo',
    title: 'メモ',
    body: (
      <>
        <h4>共有メモ (#1〜#10)</h4>
        <ul>
          <li>全員で同時に編集できるメモです。タイトルも本文も入力が止まると自動で保存されます (間隔は設定で変更可)。</li>
          <li>Markdown (見出し・箇条書き・表など) とテキストを切り替えられます。Markdown では「編集」でプレビューつき、「表示」で読みやすく表示します。</li>
          <li><K>Tab</K> で字下げできます。</li>
          <li>状態表示が「保存済み」になっていれば保存されています。</li>
        </ul>
        <h4>専用コードゾーン</h4>
        <p>メンバーごとのコード用エディタです。自分のゾーンだけ編集でき、他の人のゾーンは閲覧のみです。</p>
        <h4>メモの AI</h4>
        <ul>
          <li><b>要約</b>: 内容を短くまとめて表示します (メモは変更しません)。</li>
          <li><b>校正</b>: 誤字や表現を直した文章を表示します。「メモに反映」で本文を置き換えられます (確認あり)。反映後は「校正前に戻す」で元に戻せます。</li>
          <li><b>コード解説</b>: 専用コードゾーンのコードを解説します。</li>
        </ul>
      </>
    ),
  },
  {
    id: 'ai',
    title: 'AI タブ',
    body: (
      <>
        <ul>
          <li>何でも質問できます。今日の時間割・提出物・予定・天気などの情報は自動で AI に渡されるので、「今日の持ち物は？」のように聞けます。</li>
          <li><code>#メモ名</code> や <code>#チャンネル名</code> を書くと、その内容を読んで答えます。「メモを引用」で選択中のメモを貼り付けられます。</li>
          <li>回答は「メモに追記」で選択中のメモの末尾に足せます。</li>
          <li>会話はこの端末に保存されます。「履歴を削除」で消せます (確認あり)。</li>
        </ul>
      </>
    ),
  },
  {
    id: 'assignments',
    title: '提出物',
    body: (
      <>
        <ul>
          <li>「提出物を追加」から教科・タイトル・締切・再提出締切・内容を登録します。登録すると全員に通知されます。</li>
          <li>自分の状況を 未着手 / 進行中 / 提出済み / 再提出 / 合格 から選びます。全員が合格すると自動でアーカイブされます。</li>
          <li>「進捗」ボタンで全員の状況を確認できます。締切までの日数も表示されます。</li>
          <li>「AIで要約」で内容のポイントをまとめます。</li>
        </ul>
      </>
    ),
  },
  {
    id: 'timetable',
    title: '時間割と時程',
    body: (
      <>
        <ul>
          <li>上のバーの「今の授業」をクリックすると時間割が開きます。</li>
          <li>マスを選んで教科ボタンを押すとすぐ保存され、次のコマへ進みます。持ち物とメモも書けます。持ち物は上のバーにも出ます。</li>
          <li>表は 朝の会 → 1〜6限 → 帰りの会 の順です。曜日の下のボタンで <b>5限まで / 6限まで</b> を切り替えます。5限の日は帰りの会が5限のすぐ後になり、その時刻を過ぎると「放課後」になります。</li>
          <li>「時刻を編集」で朝の会・各時限・帰りの会の時刻を変えられます。通常・短縮・S短 それぞれ別に設定できます。</li>
          <li><b>今日の時程</b>を短縮などに変えると全員の表示が変わります (確認あり)。翌日には自動で通常時程に戻ります。</li>
        </ul>
        <p>通常時程の初期値: 朝の会 8:10〜8:25 / 1限 8:35〜9:25 / 2限 9:35〜10:25 / 3限 10:35〜11:25 / 4限 11:35〜12:25 / 5限 13:20〜14:10 / 6限 14:20〜15:10 / 帰りの会 15:10〜15:40</p>
      </>
    ),
  },
  {
    id: 'calendar',
    title: 'カレンダー',
    body: (
      <ul>
        <li>上のバーの時計をクリックすると月のカレンダーが開きます。</li>
        <li>日付を選んで「予定」から、時刻 (任意)・予定・メモを書き込めます。予定は全員が見られ、人ごとに色の点が付きます。</li>
        <li>自分の予定だけ編集・削除できます。「自分の予定だけ」で絞り込めます。</li>
        <li>時計にマウスを乗せると、1週間以内の予定が見られます。</li>
      </ul>
    ),
  },
  {
    id: 'board',
    title: 'ボードと共有クリップボード',
    body: (
      <ul>
        <li>手書き・消しゴム・文字で全員と同じボードに書けます。マウス・タッチ・ペンに対応しています。</li>
        <li>「タイムラプス」で描いた順に再生します。ゴミ箱ボタンで全員分を消します (確認あり・元に戻せません)。</li>
        <li>左下の共有クリップボードに書いた内容は全員と共有されます。「端末にコピー」で自分の端末のクリップボードにコピーできます。</li>
      </ul>
    ),
  },
  {
    id: 'tests',
    title: 'テスト点数 (その他タブ)',
    body: (
      <ul>
        <li>中間テスト / 期末テスト / 学年末テスト / 診断テスト を分けて記録します。</li>
        <li>「回」(例: 1年 2学期) を入れて、教科ごとの点数をまとめて保存します。同じ回・同じ教科を入れ直すと上書きされます。期末・学年末では実技4教科も入力できます。</li>
        <li>回ごとの合計・平均・前回との差と、教科ごとの推移の表が表示されます。</li>
        <li>「アドバイスをもらう」で、その種類のテストの推移から AI が勉強方法を提案します。</li>
        <li>右上でほかのメンバーの記録も見られます (編集はできません)。</li>
      </ul>
    ),
  },
  {
    id: 'settings',
    title: '設定',
    body: (
      <ul>
        <li><b>アカウント</b>: アイコン画像の変更・削除、パスワード変更、アカウント削除。</li>
        <li><b>表示・操作</b>: 画面の大きさ、チャットの自動スクロール、メモの自動保存の間隔。</li>
        <li><b>接続</b>: つながりにくい時の通信方式・経路の切り替えと応答速度の計測。</li>
        <li><b>通知設定</b>: ブラウザ通知 (重要な通知 / すべてのメッセージ / 通知音)。通知音は最初はオフです。</li>
        <li><b>Discord連携</b>: Discord とのメッセージ同期と Webhook。Discord に転送しているチャンネルは、古いメッセージをサーバーから自動で削除できます (初期設定は30日。ピン留めは残ります)。</li>
        <li><b>監査ログ</b>: 誰が何をしたかの記録。削除したメッセージや提出物はここから復元できます。</li>
      </ul>
    ),
  },
  {
    id: 'shortcuts',
    title: 'ショートカット',
    body: (
      <ul>
        <li><K>Ctrl</K>+<K>K</K>: コマンドパレット (タブ移動・計算。例: <code>12 * 85</code>)</li>
        <li><K>Esc</K>: 開いている画面を閉じる / 返信・編集をやめる</li>
        <li><K>Enter</K> / <K>Shift</K>+<K>Enter</K>: 送信 / 改行</li>
        <li><K>↑</K>: (入力欄が空の時) 直前の自分のメッセージを編集</li>
        <li><K>Tab</K>: 補完の候補を選ぶ / メモの字下げ。ページ内のフォーカス移動には使いません。</li>
      </ul>
    ),
  },
  {
    id: 'mobile',
    title: 'スマホで使う',
    body: (
      <ul>
        <li>タブは画面下に並びます。チャンネル一覧・メンバー一覧・メモ一覧は、ボタンで横から出てきます。</li>
        <li>上のバーの時間割・天気・時計はタップすると詳しい画面が開きます。</li>
        <li>ホーム画面に追加するとアプリのように使えます。</li>
      </ul>
    ),
  },
  {
    id: 'trouble',
    title: '困ったとき',
    body: (
      <ul>
        <li><b>オフラインと出る</b>: ネットにつながると自動で再接続し、その間のメッセージも取り込みます。</li>
        <li><b>メッセージが届かない</b>: 設定 → 接続 で通信方式を「ロングポーリング」などに変えてみてください。</li>
        <li><b>通知が来ない</b>: 上に出る「許可する」を押すか、ブラウザのサイト設定で通知を許可してください。</li>
        <li><b>メモが保存されない</b>: 状態表示が「未保存」のままなら「保存」ボタンを押してください。</li>
      </ul>
    ),
  },
];

export default function HelpTab() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tocOpen, setTocOpen] = useState(false);

  const jump = (id: string) => {
    const el = document.getElementById(`help-${id}`);
    const container = scrollRef.current;
    if (el && container) container.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
    setTocOpen(false);
  };

  const toc = (
    <ol className="space-y-0.5">
      {SECTIONS.map((s, i) => (
        <li key={s.id}>
          <button onClick={() => jump(s.id)} className="w-full text-left px-2.5 py-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800/70">
            <span className="text-amber-500/70 tabular-nums mr-1.5">{i + 1}.</span>
            {s.title}
          </button>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden text-sm">
      <aside className="hidden md:block w-60 shrink-0 border-r border-stone-800 bg-[#0C0D10] p-3 overflow-y-auto text-xs">
        <div className="flex items-center gap-1.5 px-2 mb-2 text-white font-bold">
          <BookOpen className="w-4 h-4 text-amber-400" /> 目次
        </div>
        {toc}
      </aside>
      <div ref={scrollRef} className="relative flex-1 min-w-0 overflow-y-auto p-3 sm:p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <h2 className="text-xl sm:text-2xl font-bold text-white">ヘルプ</h2>
          <div className="md:hidden bg-[#111214] border border-stone-800 rounded-xl text-xs">
            <button onClick={() => setTocOpen(v => !v)} className="w-full flex items-center justify-between px-3 py-2.5 text-white font-bold">
              <span className="flex items-center gap-1.5"><BookOpen className="w-4 h-4 text-amber-400" /> 目次</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${tocOpen ? 'rotate-180' : ''}`} />
            </button>
            {tocOpen && <div className="px-1 pb-2 anim-fade">{toc}</div>}
          </div>
          {SECTIONS.map((s, i) => (
            <section key={s.id} id={`help-${s.id}`} className="bg-[#111214] border border-stone-800/80 rounded-2xl p-4 sm:p-5 scroll-mt-4">
              <h3 className="text-white font-bold text-base mb-2">
                <span className="text-amber-500/80 mr-2 tabular-nums">{i + 1}.</span>
                {s.title}
              </h3>
              <div className="markdown-body help-body text-stone-300">{s.body}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
