# mdee 設計メモ（開発者向け）

mdee（Markdown Editor by Electron）は、mdew（Markdown Editor by WebView2）を Electron で作り直したアプリケーションです。
画面（`web` フォルダ。HTML・CSS・JavaScript）は mdew と同じもので、mdew の C#（WPF）が担当していた OS とのやり取り
（ファイルを開く・保存する、ダイアログ、メニュー、PDF への書き出し等）を、Electron のメインプロセス（Node.js）で
作り直しています。この文書は、mdee の作りを開発者向けにまとめたものです（使い方は、直下の `README.md` を参照してください。
できることは mdew と同じなので、mdew の `doc\DESIGN.md` の「今できること」も参考になります）。

作り直した理由は、起動の速さです。mdew は .NET・WPF・WebView2 の準備に時間がかかり、いつもの PC で起動に 0.9 秒ほど
かかっていました。mdee は 0.4 秒ほどで表示します（同じ PC・同じファイルでの比較）。

## フォルダ構成

- `package.json`：アプリの名前・バージョン・著作権と、開発に使うパッケージ（Electron・resedit）。
  **バージョンは、ここの `version` だけを直します**（mdee.exe のプロパティ・インストーラー・バージョン情報の画面に使います）
- `README.md`：ユーザーズガイド（「ヘルプ」→「Readmeを開く」・F1 で開く。インストーラーにも同梱します）
- `LICENSE.txt`：mdee のライセンス（MIT）
- `doc\DESIGN.md`：この文書
- `main.js`：メインプロセスの入口（アプリの起動、2 つ目に起動された時の処理、画面側からのメッセージの振り分け）
- `preload.js`：画面側に、メインプロセスとのやり取りの窓口（`window.mdeeHost`）を渡す
- `src\`：メインプロセスの処理
  - `appWindow.js`：編集のウィンドウ（mdew の `MainWindow` の移植）。画面側からのメッセージ（open・save 等）の処理
  - `files.js`：Markdown の読み書き（BOM・改行を元のままにする）、フォルダの一覧、画像のファイル名、貼り付けた画像の移動
  - `protocol.js`：文書内の画像を画面側へ返す（`https://doc.mdee/…`・`https://tmp.mdee/…`）
  - `menu.js`：メニューバーのメニュー（Electron のメニューで開く）
  - `dialogs.js` / `dialogPreload.js`：ダイアログ（表を挿入・リンク・PDF の余白・バージョン情報）と、検索と置換のウィンドウ
  - `clipboard.js`：書式付きのコピー（HTML と文字。画像のファイルは一時フォルダへ写してから渡す）
  - `settings.js`：設定（`%LocalAppData%\mdee\settings.json`）
  - `theme.js`：配色（ライト・ダーク。Windows の設定に合わせる）
  - `log.js`：エラー・起動時間の記録（`%LocalAppData%\mdee\error.log`）
- `dialog\`：ダイアログの画面（`dialog.html`・`dialog.css`・`dialog.js`。mdew の `dialog\*.xaml` の移植。
  見た目は mdew と同じ Windows 11 風）
- `web\`：画面側（mdew の `web` フォルダをコピーしたもの。窓口を `window.mdeeHost` にした等、少しだけ変えている）
  - `index.html` / `app.css`：画面の構成と見た目
  - `js\main.js`：画面全体の動き、ホストとのやり取り（冒頭のコメントにメッセージの一覧）
  - `js\editor.js` / `js\markdown.js` / `js\folder.js` / `js\find.js` / `js\clipboard.js`：mdew と同じ
- `images\mde.ico` / `images\mde.png`：アプリのアイコン（mde・mdew と同じもの）
- `tools\package.js`：配布用のフォルダ（`out\mdee`）を作る（`npm run package`）
- `build.cmd`：インストーラーを作る（npm install → npm run package → msi のビルド）
- `measure.cmd`：起動時間を続けて測る（開発用の Electron で 5 回起動して、それぞれ自動で終了する）
- `msi\`：インストーラー（WiX Toolset 5）のプロジェクト（mdew の msi を元にしたもの）
  - `msi.wixproj`：バージョンは `package.json` から読む
  - `Package.wxs`：製品名・アップグレードコード・アイコン等
  - `Directory.wxs`：インストール先のフォルダ
  - `File.wxs`：同梱するファイル（`out\mdee` の中身をフォルダごと。`Files` で入れるので、ファイルが増減しても直さなくてよい）と、
    エクスプローラーの右クリックメニュー「mdee で開く」（キーの名前は `OpenWithMdee`。mde・mdew と別）・スタートメニューへの登録
  - `UpgradeConfirmDlg.wxs`：アップグレード時の確認・右クリックメニューを追加するかの確認の画面（MS-RL）
  - `Package.ja-JP.wxl` / `Package.en-US.wxl`：画面の文言（日本語版・英語版の msi がそれぞれ作られます）
  - `License.rtf`：インストール時に表示するライセンス
  - `THIRD-PARTY-NOTICES.txt`：サードパーティ（Electron）のライセンス表示。Electron の版を上げた時は、版の番号も直してください
  - `LICENSE-MS-RL.txt`：`UpgradeConfirmDlg.wxs` のライセンス

## 開発・ビルド

Node.js（npm。22.12 以降）が必要です。インストーラーを作る時は、.NET SDK（`dotnet`）も必要です（WiX Toolset は NuGet から
自動で取得します）。

```
cd C:\src\mde_refactor\mdee
npm install
node node_modules\electron\install.js   （Electron 本体が node_modules\electron\dist に無い時だけ）
npm start                                （開発用の Electron で起動する）
npm start -- C:\path\to\file.md          （ファイルを指定して起動する）
```

インストーラーは `build.cmd` を実行すると作られます（`msi\bin\x64\Release\ja-JP\mdee.msi` と `en-US\mdee.msi`）。
`build.cmd` は次の 3 つを順に行います。

1. `npm install`（と、Electron 本体の取得）
2. `npm run package`：`out\mdee` を作る（`tools\package.js`）
   - Electron 本体（`node_modules\electron\dist`）をコピーし、`electron.exe` を `mdee.exe` に名前を変えて、アイコン・
     バージョン情報を書き換える（resedit）
   - アプリ（`main.js`・`src`・`web`・`dialog` 等）を `resources\app` に置く（asar にはまとめない）
   - Chromium の画面の文言のファイル（`locales\*.pak`）は、日本語と英語だけを残す
3. `dotnet build msi\msi.wixproj -c Release -p:Platform=x64`：`out\mdee` をインストーラーにする

## 作り

### プロセス

- アプリは 1 つのプロセスで動かします。2 つ目に起動された時（ファイルのダブルクリック・右クリックメニュー等）は、
  1 つ目のプロセスに起動時引数を渡して（`app.requestSingleInstanceLock` と `second-instance`）、そちらで新しいウィンドウを開き、
  2 つ目はすぐに終わります。Electron の準備が済んでいるので、新しいウィンドウは速く開きます（mdew は、ウィンドウごとに
  プロセスを起動していました）。
- 画面側は、Node.js の機能を使えない形（`contextIsolation`・`sandbox`）で動かし、メインプロセスとのやり取りは
  `preload.js` の窓口（`window.mdeeHost`。WebView2 の `window.chrome.webview` と同じ使い方）だけにしています。
  メッセージは mdew と同じ JSON です（`web\js\main.js` 冒頭のコメント参照）。
- 作業用のデータ（設定・ログ・Chromium のキャッシュ等）は `%LocalAppData%\mdee` に置きます（ローミングしない場所）。
  画面側の `localStorage`（アウトラインの幅・表示倍率等）も、ここに保存されます。

### 文書内の画像

画面は `file://` で読み込み、文書内の画像は、Electron の `protocol.handle('https')` で返します（`src\protocol.js`）。

- `https://doc.mdee/<ウィンドウの番号>/<世代>/<相対パス>`：開いているファイルのフォルダ基準の画像。画面側は、この URL を
  `<base href>` にして、相対パスの画像を読み込みます（mdew の `https://doc.mdew/` と同じ仕組み）。
- `https://tmp.mdee/<ウィンドウの番号>/<ファイル名>`：貼り付けた画像（保存するまでは、ウィンドウごとの一時フォルダ
  `%TEMP%\mdee\<uuid>` に置く）。保存すると `<ファイル名>.images` フォルダへ移し、文書の中の URL も相対パスに直します。
- それ以外の https（インターネット上の画像）は、そのまま読み込みます。画像以外のファイルは返しません。

### メニュー・ダイアログ

- メニューバーのメニュー（ファイル・表示・ヘルプ）は、Electron のメニュー（`Menu.popup`）で開きます（`src\menu.js`）。
  項目は画面側で作ります（mdew と同じ）。開いている間に別のメニューのボタンへマウスを移すと、そのメニューに切り替えます
  （マウスの位置を 30ms ごとに調べる）。mdew と違い、メニューを開いている時の `←`・`→` で隣のメニューへは移れません
  （Windows のポップアップメニューの決まり。サブメニューの開け閉めはできます）。
- 右クリックのメニューは、mdew と同じく画面側（HTML）のメニューです。
- ダイアログ（表を挿入・リンク・PDF の余白・バージョン情報）は、小さなウィンドウに `dialog\dialog.html` を表示します。
  開いたウィンドウの中央に、閉じるまで元のウィンドウを操作できない形で開きます。
- 検索と置換のウィンドウは、元のウィンドウの横に開き、元のウィンドウも操作できます。閉じても隠すだけで、入力した内容は
  次に開いた時まで残ります。ボタンの命令は元のウィンドウの画面側（`web\js\find.js`）へ送り、結果を受け取って表示します。
- メッセージボックス（閉じる前に保存するか等）は、Windows の標準のもの（`dialog.showMessageBox`）です。

### PDF への書き出し

`webContents.printToPDF`（A4 縦。余白は px ÷ 96 でインチにする）で書き出します。画面側が、書き出す内容を印刷用の要素
（`#print-doc`）に表示してから `exportPdf` を送ってくるので、保存先を選んでもらって書き出し、終わったら `pdfExported` を返します
（画面側は印刷用の要素を片付ける）。書き出した PDF は、既定のアプリで開きます。

## 起動時間

起動を速くするため、次のようにしています。

- ウィンドウは、画面の準備ができてから、中身ごと表示します（`show: false` で作り、画面側から `revealed` が届いたら表示する）。
  先に空のウィンドウを表示すると、中身が出るまでの間、白いウィンドウが見えて起動が遅く見えるためです（mdew と同じ）。
  準備が 4 秒（`REVEAL_TIMEOUT_MS`）を過ぎても終わらない時は、待たずに表示します。
- 最初の配色は、画面の URL（`index.html?theme=…`）で画面側に渡します（mdew と同じ）。
- メインプロセスの処理のうち、ウィンドウの表示に要らないもの（ダイアログ・PDF 等）は、使う時に読み込みます。

環境変数 `MDEE_TRACE_LOG=1` を付けて起動すると（または起動時引数に `--trace-log`）、起動にかかった時間を、起動のたびに
`%LocalAppData%\mdee\error.log` に 1 行で記録します（`measure.cmd` はこれを付けて起動します）。時間は、どれもプロセスの
開始からの時間です。付けない時は、error.log にはエラーだけを書きます（エラーが無ければ error.log は作られません）。

```
起動時間：Main=80ms Electronの準備=200ms ウィンドウ作成=260ms … 画面の準備=500ms ファイル表示=505ms 表示の指示=520ms ウィンドウ表示=540ms
```

| 名前 | 時点 |
|---|---|
| Main | `main.js` の実行が始まった |
| Electronの準備 | Electron の準備ができた（app の ready） |
| ウィンドウ作成 | ウィンドウを作った（まだ表示しない） |
| 画面の読み込みの指示 | 画面（`web\index.html`）を読み込むよう指示した |
| 画面の読み込み開始・HTML・CSS・js・main.js開始・画面の準備の送信 | 画面側の時刻（mdew と同じ） |
| 画面の準備 | 画面側から ready が届いた |
| ファイル表示 | 起動時引数のファイルを画面側に送った（無い時は「ファイル無し」） |
| ready-to-show | Electron が、表示する準備ができたと知らせた（参考） |
| 表示の指示 | 画面側から revealed が届いたので、ウィンドウを表示した |
| ウィンドウ表示 | ウィンドウが表示された |

## mdew との違い

- 実行に .NET・WebView2 ランタイムが要りません（Electron を同梱）。その分、インストーラーは大きくなります。
- ウィンドウはすべて 1 つのプロセスで開きます（上記）。
- メニューを開いている時に `←`・`→` で隣のメニューへ移れません（上記）。
- 設定・ログは `%LocalAppData%\mdee` です（mdew の設定は引き継ぎません）。
- 右クリックメニューのキーの名前は `OpenWithMdee` です（mde・mdew と一緒に入れても、別の項目になります）。
