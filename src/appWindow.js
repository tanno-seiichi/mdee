// appWindow.js
//
// mdee の一部。編集のウィンドウ（mdew の MainWindow の移植）。画面はすべて HTML（web フォルダ）で作り、ここでは
// ファイルを開く・保存するなど OS とのやり取りだけを担当する。画面側とは JSON のメッセージでやり取りする
// （web\js\main.js 冒頭のコメント参照。窓口は preload.js の window.mdeeHost）。
// mdew と違い、ウィンドウはすべて 1 つのプロセスで開く（新しいウィンドウを速く開けるように。main.js 参照）。
//
// 起動の流れ：ウィンドウは表示しないまま作り（show: false）、画面を読み込む。画面側の準備ができたら（ready）、配色・
// 設定・起動時のファイルを送り、最後に focus を送る。画面側は、起動時の内容を表示し終えると revealed を返すので、そこで
// ウィンドウを表示する（中身ごと表示する。先に空のウィンドウを表示すると、白いウィンドウが見えて起動が遅く見えるため）。

'use strict';

const { app, BrowserWindow, dialog, shell, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');
const log = require('./log');
const settings = require('./settings');
const theme = require('./theme');
const files = require('./files');

/** アプリ名（タイトルバー等）。 */
const APP_NAME = 'mdee';
/** 画面の準備を待つ最長の時間（ms）。これを過ぎたら、準備の途中でもウィンドウを表示する。 */
const REVEAL_TIMEOUT_MS = 4000;
/** 閉じる時の問い合わせに、画面側が返事をするのを待つ時間（ms）。 */
const CLOSE_QUERY_TIMEOUT_MS = 3000;
/** 初めて起動した時のウィンドウの大きさ（mde と同じ）。 */
const DEFAULT_SIZE = Object.freeze({ width: 810, height: 670 });
/** 「新規」で開くウィンドウを、元のウィンドウからずらす量。 */
const NEW_WINDOW_OFFSET = 32;

/** 開いているウィンドウ（番号 → AppWindow）。 */
const s_windows = new Map();
/** 画面（webContents の番号）→ AppWindow。 */
const s_byWebContents = new Map();
/** ウィンドウの番号（画像の URL に入れる）。 */
let s_nextId = 1;

/** package.json（バージョン・著作権の表示）。 */
const s_package = require('../package.json');

/**
 * ウィンドウの位置・大きさが、どれかの画面の作業領域に十分に入っているか。
 * @param {{x: number, y: number, width: number, height: number}} a_bounds 位置・大きさ
 * @returns {boolean}
 */
function isVisibleOnScreen(a_bounds) {
  const work = screen.getDisplayMatching(a_bounds).workArea;
  const right = Math.min(a_bounds.x + a_bounds.width, work.x + work.width);
  const bottom = Math.min(a_bounds.y + a_bounds.height, work.y + work.height);
  return right - Math.max(a_bounds.x, work.x) >= 100 && bottom - Math.max(a_bounds.y, work.y) >= 50;
}

class AppWindow {
  /**
   * ウィンドウを作って、画面を読み込む（表示は、画面の準備ができてから）。
   * @param {object} a_options
   * @param {string|null} [a_options.startupPath] 開くファイル・フォルダのパス
   * @param {AppWindow|null} [a_options.source] 「新規」等で開いた元のウィンドウ（その右下に開く）
   * @param {boolean} [a_options.measureStartup] 起動時間を記録するか（アプリの最初のウィンドウだけ）
   */
  constructor(a_options = {}) {
    this.id = s_nextId++;
    this.startupPath = a_options.startupPath || null;
    this.measureStartup = !!a_options.measureStartup;
    this.currentPath = null; // 開いているファイルのパス（新規は null）
    this.isDirty = false; // 保存していない変更があるか（画面側から dirty で知らされる）
    this.useCrLf = true; // 保存時の改行を CRLF にするか（読み込んだファイルに合わせる。新規は CRLF）
    this.hasBom = false; // 保存時に UTF-8 の BOM を付けるか（読み込んだファイルに合わせる。新規は付けない）
    this.docFolder = null; // 開いているファイルのフォルダ（相対パスの画像の基準）
    this.docGeneration = 0; // 画像の URL に入れる世代番号（ファイルを開き直すたびに増やす）
    this.folderOpen = false; // フォルダを開いているか
    this.closeConfirmed = false; // 閉じる時の確認が済んだか
    this.closeQueryTimer = null; // 閉じる時の問い合わせの返事を待つタイマー
    this.revealed = false; // ウィンドウを表示したか
    this.startupContentShown = false; // 起動時の内容（ファイル・空の文書）を画面側へ送ったか
    this.findWindow = null; // 検索と置換のウィンドウ（初めて開く時に作る）
    this.tempDir = path.join(app.getPath('temp'), APP_NAME, crypto.randomUUID().replace(/-/g, '')); // 貼り付けた画像の一時フォルダ

    const config = settings.load();
    const bounds = this.initialBounds(a_options.source, config);
    this.win = new BrowserWindow({
      ...bounds.rect,
      minWidth: 200,
      minHeight: 150,
      show: false,
      title: `${APP_NAME} v${app.getVersion()}`,
      icon: path.join(__dirname, '..', 'images', 'mde.ico'),
      backgroundColor: theme.background(),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
      },
    });
    this.maximizeOnReveal = bounds.maximized;
    if (this.measureStartup) log.mark('ウィンドウ作成');
    s_windows.set(this.id, this);
    s_byWebContents.set(this.win.webContents.id, this);
    // Electron の既定のメニュー（Ctrl+R の再読み込み等）は使わない（メニューは画面側の HTML と、src\menu.js）
    this.win.setMenu(null);
    this.setupEvents();

    this.revealTimer = setTimeout(() => {
      log.trace(`画面の準備を待たずに表示（${REVEAL_TIMEOUT_MS}ms を過ぎた）`);
      this.reveal();
    }, REVEAL_TIMEOUT_MS);
    // 最初の配色は、画面の URL の theme で渡す（画面側の main.js が、読み込んですぐに合わせる）
    this.win.loadFile(path.join(__dirname, '..', 'web', 'index.html'), { query: { theme: JSON.stringify(theme.createMessage()) } });
    if (this.measureStartup) log.mark('画面の読み込みの指示');
  }

  /**
   * 最初の位置・大きさを決める。「新規」で開いたウィンドウは、元のウィンドウ（最大化している場合はその前の位置）から
   * 右下にずらした位置に同じ大きさで開く（作業領域からはみ出す場合は、作業領域の左上）。それ以外は前回終了時の位置・大きさ。
   * @param {AppWindow|null|undefined} a_source 元のウィンドウ
   * @param {object} a_config 設定
   * @returns {{ rect: object, maximized: boolean }}
   */
  initialBounds(a_source, a_config) {
    if (a_source && !a_source.win.isDestroyed()) {
      const b = a_source.win.getNormalBounds();
      const rect = { x: b.x + NEW_WINDOW_OFFSET, y: b.y + NEW_WINDOW_OFFSET, width: b.width, height: b.height };
      const work = screen.getDisplayMatching(b).workArea;
      if (rect.x + rect.width > work.x + work.width || rect.y + rect.height > work.y + work.height) {
        rect.x = work.x;
        rect.y = work.y;
      }
      return { rect, maximized: a_source.win.isMaximized() };
    }
    const w = a_config.window;
    if (w && w.width >= 200 && w.height >= 150 && isVisibleOnScreen(w)) {
      return { rect: { x: w.x, y: w.y, width: w.width, height: w.height }, maximized: a_config.isMaximized };
    }
    return { rect: { ...DEFAULT_SIZE }, maximized: false }; // 画面の中央
  }

  /** ウィンドウ・画面のイベントを受け取る。 */
  setupEvents() {
    const win = this.win;
    const contents = win.webContents;
    // タイトルバー：画面側のタイトル（「* ファイル名」）の後ろに、アプリ名とバージョンを付ける
    win.on('page-title-updated', (e, a_title) => {
      e.preventDefault();
      win.setTitle(`${a_title} - ${APP_NAME} v${app.getVersion()}`);
    });
    // 画面の移動（リンク・ファイルのドロップ等）・新しいウィンドウは開かない（リンクは画面側が openUrl で頼む）
    contents.on('will-navigate', (e) => e.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // 手前に来た時：ほかのウィンドウで開いた・保存したファイルも、最近使ったファイルに出るよう読み直す
    win.on('focus', () => {
      if (this.revealed) this.postRecentFiles(settings.load());
    });
    // 開発用（npm start・dev.cmd・MDEE_DEBUG=1）：Ctrl+Shift+F11 で、動作の記録（トレース）を始める・止める（src\trace.js。
    // 入力の遅れ等の原因を調べるため）
    if (!app.isPackaged || '1' === process.env.MDEE_DEBUG) {
      contents.on('before-input-event', (e, a_input) => {
        if (('keyDown' === a_input.type || 'rawKeyDown' === a_input.type) && a_input.control && a_input.shift && 'F11' === a_input.key) {
          e.preventDefault();
          require('./trace').toggle().catch((ex) => log.error('トレースの記録に失敗', ex));
        }
      });
    }
    contents.on('render-process-gone', (e, a_details) => {
      log.error(`画面のプロセスが異常終了：理由=${a_details.reason} 終了コード=${a_details.exitCode}`);
    });
    win.on('close', (e) => this.onClose(e));
    win.on('closed', () => {
      clearTimeout(this.revealTimer);
      clearTimeout(this.closeQueryTimer);
      s_windows.delete(this.id);
      for (const [key, value] of s_byWebContents) {
        if (value === this) s_byWebContents.delete(key);
      }
      this.deleteTempImages();
    });
  }

  /**
   * 画面側へメッセージを送る（JSON の文字列。画面側の host の message）。
   * @param {object} a_message メッセージ（cmd と、cmd ごとの値）
   */
  post(a_message) {
    if (!this.win.isDestroyed()) this.win.webContents.send('host-message', JSON.stringify(a_message));
  }

  /**
   * 画面側に、エラーを知らせる（画面側が alert で表示する）。
   * @param {string} a_message 内容
   */
  postError(a_message) {
    this.post({ cmd: 'error', message: a_message });
  }

  /** ウィンドウを表示する（起動時に 1 回だけ）。 */
  reveal() {
    if (this.revealed || this.win.isDestroyed()) return;
    this.revealed = true;
    clearTimeout(this.revealTimer);
    if (this.measureStartup) log.mark('表示の指示');
    if (this.maximizeOnReveal) this.win.maximize();
    this.win.show();
    this.win.webContents.focus();
    if (this.measureStartup) {
      log.mark('ウィンドウ表示');
      this.finishStartupTiming();
    }
  }

  /** 起動時間を記録する（ウィンドウを表示し、起動時の内容を画面側へ送った後）。 */
  finishStartupTiming() {
    if (!this.measureStartup || !this.revealed || !this.startupContentShown) return;
    log.finish();
    // 起動時間を測るために続けて起動する時（measure.cmd）は、少し待ってから終了する
    if (process.argv.includes('--measure-exit')) setTimeout(() => app.quit(), 1500);
  }

  /**
   * 画面側から ready で届いた、画面の読み込みの各時点（main.js の startupTiming）を、起動時間の記録に加える。
   * @param {object} a_timing origin（読み込み開始の時刻）と、そこからの html・css・js・main・ready の時間（ms）
   */
  markWebTiming(a_timing) {
    if (!a_timing || 'number' !== typeof a_timing.origin) return;
    log.mark('画面の読み込み開始', a_timing.origin);
    for (const [key, name] of [['html', 'HTML'], ['css', 'CSS'], ['js', 'js'], ['main', 'main.js開始'], ['ready', '画面の準備の送信']]) {
      if ('number' === typeof a_timing[key] && a_timing[key] > 0) log.mark(name, a_timing.origin + a_timing[key]);
    }
  }

  // ===== 画面側からのメッセージ =====

  /**
   * 画面側からのメッセージを処理する（cmd ごとに振り分ける。メッセージの一覧は web\js\main.js の冒頭のコメント参照）。
   * @param {object} a_msg メッセージ
   */
  async handleMessage(a_msg) {
    const isNewWindow = true === a_msg.newWindow;
    switch (a_msg.cmd) {
      case 'ready':
        if (this.measureStartup) {
          this.markWebTiming(a_msg.timing);
          log.mark('画面の準備');
        }
        this.post(theme.createMessage());
        // 開発用（npm start）・環境変数 MDEE_DEBUG=1 の時は、ステータスバーに停止・入力遅延の回数を表示する（mdew の Debug
        // ビルドと同じ。IME・入力の遅れの検証用）
        this.post({ cmd: 'init', debug: !app.isPackaged || '1' === process.env.MDEE_DEBUG, tempDir: this.tempDir });
        this.postRecentFiles(settings.load());
        this.openStartupPath();
        if (this.measureStartup) log.mark(this.currentPath ? 'ファイル表示' : 'ファイル無し');
        this.startupContentShown = true;
        // 画面側は、focus を受け取ると画面を見せて（app-ready）、編集領域にカーソルを置き、revealed を返す
        // （起動時のファイルの load の後に届くので、ファイルを表示し終えた画面を見せられる）
        this.post({ cmd: 'focus' });
        break;
      case 'revealed':
        this.reveal();
        break;
      case 'setTheme': {
        // メニュー「表示」→「テーマ」：選び方を保存して、すべてのウィンドウに反映する（main.js の theme.onChanged）
        const mode = theme.normalize(a_msg.mode);
        settings.update((s) => { s.theme = mode; });
        theme.setMode(mode);
        broadcastTheme();
        break;
      }
      case 'open': {
        const result = await dialog.showOpenDialog(this.win, {
          properties: ['openFile'],
          filters: [{ name: 'Markdown ファイル', extensions: ['md', 'markdown'] }, { name: 'すべてのファイル', extensions: ['*'] }],
        });
        if (result.canceled || !result.filePaths.length) break;
        const file = result.filePaths[0];
        // newWindow：このウィンドウでフォルダ・ファイルを開いている時は、新しいウィンドウで開く（main.js の opensInNewWindow）。
        // ただし、このウィンドウで開いているファイルそのものを選んだ時は、このウィンドウで開き直す
        if (isNewWindow && !files.samePath(file, this.currentPath)) openWindow({ startupPath: file, source: this });
        else this.loadFile(file);
        break;
      }
      case 'save':
        await this.saveFileAndReport(a_msg.markdown, true === a_msg.saveAs, a_msg.images);
        break;
      case 'dirty':
        this.isDirty = true === a_msg.value;
        break;
      case 'newWindow':
        openWindow({ source: this });
        break;
      case 'about':
        // バージョン情報（このウィンドウの中央に、閉じるまで操作できない形で開く）
        await require('./dialogs').openDialog(this.win, 'about',
          { title: APP_NAME, version: app.getVersion(), copyright: s_package.copyright || '' }, { onReadme: () => this.openReadme() });
        break;
      case 'devTools':
        // F12：開発者ツール
        this.win.webContents.openDevTools({ mode: 'detach' });
        break;
      case 'openUrl':
        this.openUrl(a_msg.url);
        break;
      case 'openRelative':
        this.openRelativeFile(a_msg.path);
        break;
      case 'pasteImage':
        this.savePastedImage(a_msg.id, a_msg.type, a_msg.data);
        break;
      case 'openFolder':
        await this.openFolder('string' === typeof a_msg.relPath ? a_msg.relPath : null, isNewWindow);
        break;
      case 'listDir':
        this.post({ cmd: 'dirList', path: a_msg.path, ...files.listMarkdownEntries(a_msg.path) });
        break;
      case 'openPath':
        if (fs.existsSync(a_msg.path)) this.loadFile(a_msg.path);
        else this.postError(`ファイルが見つかりません。\n${a_msg.path}`);
        break;
      case 'readFolderFiles':
        this.post({ cmd: 'folderFiles', reqId: a_msg.reqId, files: files.readFolderFiles(a_msg.root) });
        break;
      case 'saveAll':
        await this.saveAll(a_msg.files || []);
        break;
      case 'confirmClose':
        await this.confirmClose(a_msg.files || []);
        break;
      case 'openFind':
        this.showFindWindow('string' === typeof a_msg.text ? a_msg.text : '');
        break;
      case 'findUpdate': {
        const { cmd, ...update } = a_msg;
        this.findWindow?.applyUpdate(update);
        break;
      }
      case 'openImage':
        await this.openImage(a_msg.src);
        break;
      case 'exportPdf':
        await this.exportPdf(a_msg.name);
        break;
      case 'pdfMargin':
        await this.showPdfMarginDialog();
        break;
      case 'showMenu':
        require('./menu').showWebMenu(this.win, a_msg, (m) => this.post(m));
        break;
      case 'tableSizeDialog': {
        // 右クリックのメニュー「表を挿入…」：取りやめた時も知らせる（行数・列数が 0 なら取りやめ）
        const result = await require('./dialogs').openDialog(this.win, 'table', {}, { onReadme: () => this.openReadme() });
        this.focusPage();
        this.post({ cmd: 'tableSize', rows: result ? result.rows : 0, cols: result ? result.cols : 0 });
        break;
      }
      case 'linkDialog': {
        // 右クリックのメニュー「リンクにする…」：取りやめた時・URL が空の時も知らせる（url が空なら取りやめ）
        const result = await require('./dialogs').openDialog(this.win, 'link', { url: '' }, { onReadme: () => this.openReadme() });
        this.focusPage();
        this.post({ cmd: 'linkUrl', url: result ? result.url : '' });
        break;
      }
      case 'copyHtml':
        require('./clipboard').copyHtml(a_msg.html, a_msg.text);
        break;
      case 'importImages':
        this.post({ cmd: 'imagesImported', id: a_msg.id, urls: (a_msg.srcs || []).map((s) => this.importImage(s)) });
        break;
      case 'openRecent':
        this.openRecentFile(a_msg.path, isNewWindow);
        break;
      case 'clearRecent':
        this.postRecentFiles(settings.update((s) => { s.recentFiles = []; }));
        break;
      case 'openRecentFolder':
        this.openRecentFolder(a_msg.path, 'string' === typeof a_msg.relPath ? a_msg.relPath : null, isNewWindow);
        break;
      case 'clearRecentFolders':
        this.postRecentFiles(settings.update((s) => { s.recentFolders = []; }));
        break;
      case 'close':
        // メニュー「閉じる」（Ctrl+W）：保存していない変更があれば、onClose で確認する
        this.win.close();
        break;
      case 'openReadme':
        this.openReadme();
        break;
      default:
        // imeOn（mdew の自動テスト用の機能）等、mdee では使わないもの
        break;
    }
  }

  /** キーボードの入力先を、編集画面に戻す。 */
  focusPage() {
    if (this.win.isDestroyed()) return;
    this.win.focus();
    this.win.webContents.focus();
  }

  // ===== 最近使ったファイル・フォルダ =====

  /**
   * 最近使ったファイル・フォルダの一覧を、画面側へ送る（メニューを開いた時に表示する）。
   * @param {object} a_settings 設定
   */
  postRecentFiles(a_settings) {
    this.post({ cmd: 'recentFiles', files: a_settings.recentFiles, folders: a_settings.recentFolders });
  }

  /**
   * 開いた・保存したファイルを、最近使ったファイルの先頭に加える。
   * @param {string} a_path パス
   */
  addRecentFile(a_path) {
    const full = path.resolve(a_path);
    this.postRecentFiles(settings.update((s) => settings.addRecent(s.recentFiles, full)));
  }

  /**
   * 開いたフォルダを、最近使ったフォルダの先頭に加える。
   * @param {string} a_folder パス
   */
  addRecentFolder(a_folder) {
    const full = path.resolve(a_folder);
    this.postRecentFiles(settings.update((s) => settings.addRecent(s.recentFolders, full)));
  }

  /**
   * 最近使ったファイルを開く。ファイルが無い（移動・削除された）場合は、そのことを知らせて一覧から消す。
   * @param {string} a_path パス
   * @param {boolean} a_newWindow 新しいウィンドウで開くか
   */
  openRecentFile(a_path, a_newWindow) {
    if (fs.existsSync(a_path) && fs.statSync(a_path).isFile()) {
      if (a_newWindow) openWindow({ startupPath: a_path, source: this });
      else this.loadFile(a_path);
      return;
    }
    this.postRecentFiles(settings.update((s) => settings.removeRecent(s.recentFiles, a_path)));
    this.postError(`ファイルが見つかりませんでした。\n${a_path}`);
  }

  /**
   * 最近使ったフォルダを開く。フォルダが無い場合は、そのことを知らせて一覧から消す。
   * @param {string} a_folder パス
   * @param {string|null} a_relPath 今のファイルの、今のフォルダからの相対パス
   * @param {boolean} a_newWindow 新しいウィンドウで開くか
   */
  openRecentFolder(a_folder, a_relPath, a_newWindow) {
    if (fs.existsSync(a_folder) && fs.statSync(a_folder).isDirectory()) {
      if (a_newWindow) openWindow({ startupPath: a_folder, source: this });
      else this.openFolderPath(a_folder, a_relPath);
      return;
    }
    this.postRecentFiles(settings.update((s) => settings.removeRecent(s.recentFolders, a_folder)));
    this.postError(`フォルダが見つかりませんでした。\n${a_folder}`);
  }

  // ===== ファイル・フォルダを開く =====

  /** 画面側の準備ができた時点で、起動時のファイル・フォルダを開く（最初の 1 回だけ）。 */
  openStartupPath() {
    const target = this.startupPath;
    this.startupPath = null;
    if (!target) return;
    let stat = null;
    try {
      stat = fs.statSync(target);
    } catch {
      stat = null;
    }
    if (stat && stat.isFile()) {
      this.loadFile(target);
    } else if (stat && stat.isDirectory()) {
      // フォルダを指定して起動した場合は、フォルダビューに読み込んで、直下の最初のファイルを開く（mde と同じ）
      this.openFolderPath(target, null);
    } else {
      // お知らせだけが先に出ないよう、ウィンドウを表示してから知らせる
      this.reveal();
      dialog.showMessageBox(this.win, { type: 'warning', title: APP_NAME, message: `起動時に指定されたファイルが見つかりません。\n${target}` });
    }
  }

  /**
   * 開いているファイルのフォルダを、画像の読み込み元として設定する。
   * @param {string} a_path 開いた・保存したファイルのパス
   * @returns {string} 画面側で <base href> に使う URL（https://doc.mdee/<ウィンドウの番号>/<世代>/）
   */
  setDocumentFolder(a_path) {
    this.docFolder = path.dirname(path.resolve(a_path));
    this.docGeneration++;
    return `${files.DOC_URL_PREFIX}${this.id}/${this.docGeneration}/`;
  }

  /**
   * ファイルを読み込んで、画面側に表示させる（load を送る）。BOM の有無・改行の種類は、保存する時のために覚えておく。
   * @param {string} a_path パス
   */
  loadFile(a_path) {
    try {
      const { text, bom, crlf } = files.readMarkdown(a_path);
      this.hasBom = bom;
      this.useCrLf = crlf;
      this.currentPath = a_path;
      const docBase = this.setDocumentFolder(a_path);
      this.post({ cmd: 'load', path: a_path, name: path.basename(a_path), docBase, markdown: text });
      this.addRecentFile(a_path);
    } catch (ex) {
      this.postError(`ファイルを開けませんでした。\n${ex.message}`);
    }
  }

  /** 新規の文書（無題・空）にする。 */
  resetToNewDocument() {
    this.currentPath = null;
    this.hasBom = false;
    this.useCrLf = true;
    this.post({ cmd: 'load', path: null, name: '無題', docBase: null, markdown: '' });
  }

  /**
   * メニュー「フォルダを開く...」：フォルダを選ぶダイアログを出し、選ばれたら開く。
   * @param {string|null} a_relPath 今のファイルの、今のフォルダからの相対パス
   * @param {boolean} a_newWindow 選んだフォルダを新しいウィンドウで開くか
   */
  async openFolder(a_relPath, a_newWindow) {
    const result = await dialog.showOpenDialog(this.win, { title: 'フォルダを開く', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths.length) return;
    if (a_newWindow) openWindow({ startupPath: result.filePaths[0], source: this });
    else this.openFolderPath(result.filePaths[0], a_relPath);
  }

  /**
   * フォルダを開く（画面側に folderOpened を送ってから、そのフォルダのファイルを 1 つ開く。mde と同じく、今のファイルと
   * 同じ相対パスのファイルがあればそれを、無ければフォルダの直下の最初のファイル。どちらも無ければ新規の文書）。
   * @param {string} a_folder フォルダのパス
   * @param {string|null} a_relPath 開きたいファイルの、フォルダからの相対パス
   */
  openFolderPath(a_folder, a_relPath) {
    let folder = path.resolve(a_folder);
    if (folder.length > 3) folder = folder.replace(/[\\/]+$/, '');
    const name = path.basename(folder);
    this.folderOpen = true;
    this.findWindow?.setFolderAvailable(true);
    this.post({ cmd: 'folderOpened', root: folder, name: name || folder });
    this.addRecentFolder(folder);
    let open = null;
    if (a_relPath) {
      const candidate = path.join(folder, a_relPath);
      if (fs.existsSync(candidate)) open = candidate;
    }
    if (!open) open = files.listMarkdownEntries(folder).files[0] || null;
    if (open) this.loadFile(open);
    else this.resetToNewDocument();
  }

  /**
   * 相対パスで書かれた Markdown ファイルへのリンクを、開いているファイルのフォルダ基準で解決して、このウィンドウで開く。
   * @param {string} a_relativePath リンクに書かれた相対パス（# より後ろは除いたもの）
   */
  openRelativeFile(a_relativePath) {
    if (!this.currentPath) {
      this.postError('保存していない文書では、相対パスのリンクは開けません。');
      return;
    }
    const full = path.resolve(path.dirname(this.currentPath), String(a_relativePath || '').replace(/[\\/]/g, path.sep));
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      this.postError(`リンク先のファイルが見つかりません。\n${a_relativePath}`);
      return;
    }
    this.loadFile(full);
  }

  /**
   * リンク先の URL を、既定のブラウザ・メールソフトで開く（誤ってプログラム等を実行しないよう、http・https・mailto だけ）。
   * @param {string} a_url URL
   */
  openUrl(a_url) {
    let url = null;
    try {
      url = new URL(a_url);
    } catch {
      url = null;
    }
    if (!url || !['http:', 'https:', 'mailto:'].includes(url.protocol)) {
      this.postError(`このリンクは開けません。\n${a_url}`);
      return;
    }
    shell.openExternal(url.href).catch((ex) => this.postError(`リンク先を開けませんでした。\n${a_url}\n${ex.message}`));
  }

  /** 「ヘルプ」→「Readmeを開く」（F1）：アプリの README.md を、新しいウィンドウで開く。 */
  openReadme() {
    const readme = path.join(app.getAppPath(), 'README.md');
    if (!fs.existsSync(readme)) {
      dialog.showMessageBox(this.win, { type: 'warning', title: 'Readmeを開く', message: `README.md が見つかりませんでした：${readme}` });
      return;
    }
    openWindow({ startupPath: readme, source: this });
  }

  // ===== 保存 =====

  /**
   * ファイルに保存し、画面側に saved を送る。失敗したら error を送る。
   * @param {string} a_markdown 保存する内容（改行は LF）
   * @param {boolean} a_saveAs 名前を付けて保存か
   * @param {string[]} a_images 文書内の画像の参照先
   */
  async saveFileAndReport(a_markdown, a_saveAs, a_images) {
    const result = await this.saveFile(a_markdown, a_saveAs, a_images);
    if (!result.ok && result.error) this.postError(`保存できませんでした。\n${result.error}`);
  }

  /**
   * ファイルに保存し、画面側に saved を送る。新規の文書・名前を付けて保存の場合は、保存先を選ぶダイアログを出す。
   * 画像は保存先に合わせてコピーし、参照先を書き換える。
   * @param {string} a_markdown 保存する内容（改行は LF）
   * @param {boolean} a_saveAs 名前を付けて保存か
   * @param {string[]} a_images 文書内の画像の参照先
   * @returns {Promise<{ ok: boolean, error: string|null }>} error は、保存先を選ぶダイアログでキャンセルした時は null
   */
  async saveFile(a_markdown, a_saveAs, a_images) {
    const oldPath = this.currentPath;
    let target = this.currentPath;
    if (a_saveAs || !target) {
      const result = await dialog.showSaveDialog(this.win, {
        defaultPath: target || '無題.md',
        filters: [{ name: 'Markdown ファイル', extensions: ['md'] }, { name: 'すべてのファイル', extensions: ['*'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, error: null };
      target = result.filePath;
    }
    try {
      const replacements = {};
      // 「名前を付けて保存」で保存先が変わる場合は、相対パスの画像も新しい保存先へコピーする
      let markdown = files.relocateRelativeImages(String(a_markdown ?? ''), oldPath, target, Array.isArray(a_images) ? a_images : [], replacements);
      // 貼り付けた画像（一時フォルダ）を、保存先の「<ファイル名>.images」へ移す
      markdown = files.relocateTempImages(markdown, target, this.tempDir, replacements);
      files.writeMarkdown(target, markdown, this.useCrLf, this.hasBom);
      this.currentPath = target;
      const docBase = this.setDocumentFolder(target);
      this.post({ cmd: 'saved', path: target, name: path.basename(target), docBase, markdown, replacements });
      this.addRecentFile(target);
      return { ok: true, error: null };
    } catch (ex) {
      return { ok: false, error: ex.message };
    }
  }

  /**
   * 開いていないファイルに内容を書き出す（BOM の有無・改行の種類は、今のファイルの内容に合わせる。貼り付けた画像は
   * 「<ファイル名>.images」へ移す）。
   * @param {string} a_path パス
   * @param {string} a_markdown 内容（改行は LF）
   */
  writeOtherFile(a_path, a_markdown) {
    let bom = false;
    let crlf = true;
    if (fs.existsSync(a_path)) {
      const current = files.readMarkdown(a_path);
      bom = current.bom;
      crlf = current.crlf;
    }
    files.writeMarkdown(a_path, files.relocateTempImages(a_markdown, a_path, this.tempDir, {}), crlf, bom);
  }

  /**
   * 保存していない内容をすべて保存する（開いているファイルは saveFile、それ以外は writeOtherFile）。
   * @param {object[]} a_files path・markdown・images・current の配列
   * @returns {Promise<{ saved: string[], failed: object[], canceled: boolean }>}
   */
  async saveFiles(a_files) {
    const saved = [];
    const failed = [];
    for (const f of a_files) {
      if (f.current) {
        const result = await this.saveFile(f.markdown, false, f.images);
        if (result.ok) saved.push(this.currentPath);
        else if (null === result.error) return { saved, failed, canceled: true };
        else failed.push({ path: f.path || '(無題)', message: result.error });
        continue;
      }
      try {
        this.writeOtherFile(f.path, f.markdown);
        saved.push(f.path);
      } catch (ex) {
        failed.push({ path: f.path, message: ex.message });
      }
    }
    return { saved, failed, canceled: false };
  }

  /**
   * メニュー「ファイル」→「すべて保存」：終わったら、保存できたファイルと失敗したファイルを savedAll で知らせる。
   * @param {object[]} a_files path・markdown・images・current の配列
   */
  async saveAll(a_files) {
    const result = await this.saveFiles(a_files);
    this.post({ cmd: 'savedAll', saved: result.saved, failed: result.failed });
  }

  // ===== 画像 =====

  /**
   * 貼り付けられた画像を一時フォルダに「clipboard_image_連番.拡張子」で保存し、表示用の仮の URL を画面側へ返す。
   * @param {number} a_id 画面側が付けた画像の番号
   * @param {string} a_mimeType 画像の種類（image/png 等）
   * @param {string} a_base64 画像のデータ（Base64）
   */
  savePastedImage(a_id, a_mimeType, a_base64) {
    try {
      const ext = { 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/bmp': '.bmp', 'image/webp': '.webp' }[a_mimeType] || '.png';
      fs.mkdirSync(this.tempDir, { recursive: true });
      const name = files.sequentialFileName(this.tempDir, files.PASTED_IMAGE_BASE_NAME, ext);
      fs.writeFileSync(path.join(this.tempDir, name), Buffer.from(a_base64 || '', 'base64'));
      this.post({ cmd: 'imagePasted', id: a_id, url: this.tempImageUrl(name), alt: path.basename(name, ext) });
    } catch (ex) {
      this.postError(`クリップボードの画像を貼り付けられませんでした。\n${ex.message}`);
    }
  }

  /**
   * 一時フォルダの画像の仮の URL。
   * @param {string} a_name ファイル名
   * @returns {string}
   */
  tempImageUrl(a_name) {
    return `${files.TMP_URL_PREFIX}${this.id}/${encodeURIComponent(a_name)}`;
  }

  /**
   * 他のアプリが置いた画像のファイル（Excel の一時ファイル等。file:///…）を、一時フォルダへコピーする。
   * @param {string} a_src 画像の参照先
   * @returns {string|null} 仮の URL（コピーできなければ null）
   */
  importImage(a_src) {
    try {
      if (!/^file:/i.test(a_src)) return null;
      const source = fileURLToPath(a_src);
      if (!fs.existsSync(source) || !files.isImageFile(source)) return null;
      fs.mkdirSync(this.tempDir, { recursive: true });
      const ext = path.extname(source).toLowerCase();
      const name = files.sequentialFileName(this.tempDir, files.PASTED_IMAGE_BASE_NAME, ext);
      fs.copyFileSync(source, path.join(this.tempDir, name));
      return this.tempImageUrl(name);
    } catch (ex) {
      log.error('貼り付けた画像をコピーできませんでした', ex);
      return null;
    }
  }

  /**
   * 画像の参照先を、ファイルのパスにする（ファイルではない参照先・解決できない場合は null）。
   * @param {string} a_src 画像の参照先（文書に書かれたまま。貼り付けた画像は https://tmp.mdee/…）
   * @returns {string|null}
   */
  resolveImagePath(a_src) {
    try {
      const tempName = files.tempImageName(a_src);
      if (tempName) return path.join(this.tempDir, tempName);
      if (/^file:/i.test(a_src)) return fileURLToPath(a_src);
      if (/^data:/i.test(a_src) || a_src.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]+:\/\//.test(a_src)) return null;
      const pathPart = a_src.split(/[?#]/)[0].replace(/[\\/]/g, path.sep);
      if (path.isAbsolute(pathPart)) return path.resolve(pathPart);
      if (!this.docFolder) return null; // 保存していない文書の相対パス
      const full = path.resolve(this.docFolder, pathPart);
      if (fs.existsSync(full)) return full;
      try {
        return path.resolve(this.docFolder, decodeURIComponent(pathPart));
      } catch {
        return full;
      }
    } catch {
      return null;
    }
  }

  /**
   * 画像を既定のアプリで開く（http・https の画像はブラウザで開く。誤ってプログラム等を実行しないよう、画像の拡張子の
   * ファイルだけを開く）。
   * @param {string} a_src 画像の参照先
   */
  async openImage(a_src) {
    const src = String(a_src || '').trim();
    if (/^https?:\/\//i.test(src) && !files.tempImageName(src)) {
      this.openUrl(src);
      return;
    }
    const file = this.resolveImagePath(src);
    if (!file || !fs.existsSync(file)) {
      this.postError(`この画像は開けません（元のファイルが見つからないか、埋め込みの画像です）。\n${src}`);
      return;
    }
    if (!files.isImageFile(file)) {
      this.postError(`画像のファイルではないため開けません。\n${file}`);
      return;
    }
    const error = await shell.openPath(file);
    if (error) this.postError(`画像を開けませんでした。\n${file}\n${error}`);
  }

  /** このウィンドウの一時フォルダを削除する（保存しなかった貼り付け画像の後始末）。 */
  deleteTempImages() {
    try {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    } catch {
      // 削除できなくても致命的ではない
    }
  }

  // ===== PDF =====

  /**
   * PDF に書き出す。画面側が、書き出す内容を印刷用の要素（#print-doc）に表示してから exportPdf を送ってくる（印刷用の
   * 見た目は web\app.css の @media print）。保存先を選び、A4 縦・設定した余白で書き出して、既定のアプリで開く。
   * 終わったら pdfExported を送る。
   * @param {string} a_name 文書の名前（PDF のファイル名の初期値に使う）
   */
  async exportPdf(a_name) {
    let ok = false;
    try {
      const baseName = this.currentPath
        ? path.basename(this.currentPath, path.extname(this.currentPath))
        : path.basename(a_name || '無題', path.extname(a_name || ''));
      const result = await dialog.showSaveDialog(this.win, {
        title: 'PDFに書き出し',
        defaultPath: this.currentPath ? path.join(path.dirname(this.currentPath), `${baseName}.pdf`) : `${baseName}.pdf`,
        filters: [{ name: 'PDF ファイル', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) return;
      const margin = settings.load().pdfMargin; // ほかのウィンドウで余白を変えた場合も、最新の値を使う
      const data = await this.win.webContents.printToPDF({
        pageSize: 'A4',
        landscape: false,
        printBackground: true,
        displayHeaderFooter: false,
        margins: { top: margin.top / 96, bottom: margin.bottom / 96, left: margin.left / 96, right: margin.right / 96 },
      });
      try {
        fs.writeFileSync(result.filePath, data);
      } catch (ex) {
        this.postError(`PDFに書き出せませんでした（ファイルが他のアプリで開かれている等）。\n${result.filePath}\n${ex.message}`);
        return;
      }
      ok = true;
      await shell.openPath(result.filePath); // PDF を開くアプリが無い場合等は、何もしない（書き出しはできている）
    } catch (ex) {
      log.error('PDFに書き出せませんでした', ex);
      this.postError(`PDFに書き出せませんでした。\n${ex.message}`);
    } finally {
      this.post({ cmd: 'pdfExported', ok });
    }
  }

  /** メニュー「PDFの余白を設定…」：設定した余白は、すぐに設定ファイルに保存する（次に書き出す時から使う）。 */
  async showPdfMarginDialog() {
    const current = settings.load().pdfMargin;
    const result = await require('./dialogs').openDialog(this.win, 'pdfMargin',
      { values: current, defaults: settings.PDF_MARGIN_DEFAULTS }, { onReadme: () => this.openReadme() });
    this.focusPage();
    if (result) settings.update((s) => { s.pdfMargin = { ...s.pdfMargin, ...result }; });
  }

  // ===== 検索と置換 =====

  /**
   * 検索と置換のウィンドウを開く（開いていれば前に出して、検索する文字列の入力欄に移る）。
   * @param {string} a_selectedText 編集領域で範囲選択していた文字列
   */
  showFindWindow(a_selectedText) {
    if (!this.findWindow) {
      const { FindWindow } = require('./dialogs');
      this.findWindow = new FindWindow(this.win, {
        // ボタンが押された：入力された内容と一緒に、画面側（find.js）へ送る
        onCommand: (a_command) => {
          this.post({
            cmd: 'findCommand', action: a_command.action, query: a_command.query ?? '', replacement: a_command.replacement ?? '',
            folder: !!a_command.folder, matchCase: !!a_command.matchCase, regex: !!a_command.regex,
            index: Number.isInteger(a_command.index) ? a_command.index : -1,
          });
        },
        onReadme: () => this.openReadme(),
      });
    }
    this.findWindow.setFolderAvailable(this.folderOpen);
    this.findWindow.show({ selectedText: a_selectedText });
  }

  // ===== 閉じる =====

  /**
   * ウィンドウを閉じる前に、保存していない変更があれば確認する（画面側に保存していない内容を問い合わせて、返事が
   * 届いたら confirmClose で確認する）。閉じる場合は、ウィンドウの位置・大きさを次回のために保存する。
   * @param {Electron.Event} a_event close のイベント
   */
  onClose(a_event) {
    if (this.isDirty && !this.closeConfirmed) {
      a_event.preventDefault();
      if (this.closeQueryTimer) return;
      // 画面が応答しない等で返事が無ければ、保存はできない旨の確認を出す（閉じられなくならないように）
      this.closeQueryTimer = setTimeout(() => this.confirmClose(null), CLOSE_QUERY_TIMEOUT_MS);
      this.post({ cmd: 'confirmClose' });
      return;
    }
    this.findWindow?.close();
    this.saveWindowPlacement();
  }

  /**
   * 閉じる時の確認（「…は変更されています。閉じる前に保存しますか？」）を出す。はい：保存してから閉じる（保存先を
   * 選ぶダイアログでキャンセルした・保存に失敗した時は閉じない）。いいえ：保存せずに閉じる。キャンセル：閉じない。
   * @param {object[]|null} a_files 画面側から届いた、保存していない内容（返事が無かった時は null）
   */
  async confirmClose(a_files) {
    if (!this.closeQueryTimer) return;
    clearTimeout(this.closeQueryTimer);
    this.closeQueryTimer = null;
    const names = a_files ? a_files.map((f) => (f.path ? path.basename(f.path) : '無題'))
      : [this.currentPath ? path.basename(this.currentPath) : '無題'];
    if (a_files && !names.length) {
      // 問い合わせている間に保存された等で、保存していない内容が無くなった
      this.closeConfirmed = true;
      this.win.close();
      return;
    }
    // 変更されているファイルの名前（多い時は 4 個まで出して、残りは「ほか n 個のファイル」）
    const lines = names.length > 5 ? [...names.slice(0, 4), `ほか ${names.length - 4} 個のファイル`] : names;
    if (!a_files) {
      // 画面側から返事が無い：保存はできないので、保存せずに閉じるかだけ確認する（既定は「いいえ」）
      const { response } = await dialog.showMessageBox(this.win, {
        type: 'question', title: APP_NAME, buttons: ['はい(&Y)', 'いいえ(&N)'], defaultId: 1, cancelId: 1, noLink: true,
        message: `${lines.join('\n')}\nは変更されています。\n画面が応答しないため保存できません。保存せずに閉じますか？`,
      });
      if (0 === response) {
        this.closeConfirmed = true;
        this.win.close();
      }
      return;
    }
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'question', title: APP_NAME, buttons: ['はい(&Y)', 'いいえ(&N)', 'キャンセル'], defaultId: 0, cancelId: 2, noLink: true,
      message: `${lines.join('\n')}\nは変更されています。閉じる前に保存しますか？`,
    });
    if (1 === response) {
      this.closeConfirmed = true;
      this.win.close();
    } else if (0 === response) {
      const result = await this.saveFiles(a_files);
      if (result.canceled) return; // 保存先を選ぶダイアログでキャンセルした：閉じない
      if (!result.failed.length) {
        this.closeConfirmed = true;
        this.win.close();
        return;
      }
      this.post({ cmd: 'savedAll', saved: result.saved, failed: result.failed });
    }
  }

  /** ウィンドウの位置・大きさ（最大化する前のもの）と、最大化しているかを、次回のために保存する。 */
  saveWindowPlacement() {
    if (this.win.isDestroyed() || !this.revealed) return;
    const bounds = this.win.getNormalBounds();
    const maximized = this.win.isMaximized();
    settings.update((s) => {
      s.window = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      s.isMaximized = maximized;
    });
  }
}

/**
 * 新しいウィンドウを開く。
 * @param {object} a_options AppWindow の constructor と同じ
 * @returns {AppWindow}
 */
function openWindow(a_options = {}) {
  return new AppWindow(a_options);
}

/**
 * 画面（webContents の番号）から、そのウィンドウを得る。
 * @param {number} a_id webContents の番号
 * @returns {AppWindow|undefined}
 */
function fromWebContents(a_id) {
  return s_byWebContents.get(a_id);
}

/**
 * ウィンドウの番号から、画像の読み込みに必要な情報を得る（src\protocol.js）。
 * @param {number} a_id ウィンドウの番号
 * @returns {{ docFolder: string|null, tempDir: string }|null}
 */
function imageSourceOf(a_id) {
  const w = s_windows.get(a_id);
  return w ? { docFolder: w.docFolder, tempDir: w.tempDir } : null;
}

/** 配色が変わった時：すべてのウィンドウの背景と、画面側の配色を合わせ直す。 */
function broadcastTheme() {
  const message = theme.createMessage();
  for (const w of s_windows.values()) {
    if (w.win.isDestroyed()) continue;
    w.win.setBackgroundColor(theme.background());
    w.post(message);
    w.findWindow?.applyTheme();
  }
  require('./dialogs').broadcastTheme();
}

module.exports = { APP_NAME, AppWindow, openWindow, fromWebContents, imageSourceOf, broadcastTheme };
