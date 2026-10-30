// dialogs.js
//
// mdee の一部。mdee のダイアログ（表を挿入・リンク・PDF の余白・バージョン情報）と、検索と置換のウィンドウ
// （mdew の dialog\*.xaml の移植）。どちらも小さなウィンドウ（BrowserWindow）に dialog\dialog.html を表示する。
//  - ダイアログ：開いたウィンドウ（親）の中央に、閉じるまで親を操作できない形（modal）で開く。結果（入力された値。
//    キャンセルは null）を Promise で返す。
//  - 検索と置換：親の横に開き、閉じるまで親も操作できる。閉じても隠すだけにして、入力した内容を次に開いた時まで残す。
//    ボタンが押されたら、その命令を親の画面側（web\js\find.js）へ送り、処理の結果（findUpdate）を受け取って表示する。
// 画面側（dialog\dialog.js）とは、preload（src\dialogPreload.js）を通してやり取りする。

'use strict';

const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');
const theme = require('./theme');

/** ダイアログの画面のファイル。 */
const DIALOG_HTML = path.join(__dirname, '..', 'dialog', 'dialog.html');
/** ダイアログの preload。 */
const DIALOG_PRELOAD = path.join(__dirname, 'dialogPreload.js');

/** ダイアログの種類ごとの、タイトルと幅（中身の高さに合わせて、高さは開く時に決める）。 */
const KINDS = Object.freeze({
  table: { title: '表を挿入', width: 300 },
  link: { title: 'リンク', width: 380 },
  pdfMargin: { title: 'PDFの余白を設定', width: 360 },
  about: { title: 'mdee', width: 230 },
  find: { title: '検索と置換', width: 550 },
});

/** ダイアログの画面（webContents の番号）→ そのダイアログの情報（結果の受け取り先等）。 */
const s_dialogs = new Map();
/** ダイアログの画面からのメッセージを受け取る処理を登録したか（初めてダイアログを開く時に登録する）。 */
let s_ipcRegistered = false;

/**
 * ダイアログのウィンドウを作る（まだ表示しない）。
 * @param {BrowserWindow} a_parent 親のウィンドウ
 * @param {string} a_kind 種類（KINDS のキー）
 * @param {object} a_data ダイアログに渡す値
 * @param {boolean} a_modal 親を操作できないようにするか
 * @returns {BrowserWindow}
 */
function createWindow(a_parent, a_kind, a_data, a_modal) {
  registerIpc();
  const kind = KINDS[a_kind];
  const win = new BrowserWindow({
    parent: a_parent,
    modal: a_modal,
    show: false,
    width: kind.width,
    height: 200,
    useContentSize: true,
    resizable: 'find' === a_kind,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: kind.title,
    backgroundColor: theme.isDark() ? '#202020' : '#FFFFFF',
    autoHideMenuBar: true,
    webPreferences: { preload: DIALOG_PRELOAD, contextIsolation: true, sandbox: true, spellcheck: false },
  });
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(DIALOG_HTML, { query: { kind: a_kind, data: JSON.stringify(a_data || {}), dark: theme.isDark() ? '1' : '0' } });
  return win;
}

/**
 * ウィンドウを、親のウィンドウの中央に置く（画面の作業領域からはみ出さないように）。
 * @param {BrowserWindow} a_win ウィンドウ
 * @param {BrowserWindow} a_parent 親
 */
function centerOnParent(a_win, a_parent) {
  const p = a_parent.getBounds();
  const b = a_win.getBounds();
  const work = screen.getDisplayMatching(p).workArea;
  const x = Math.max(work.x, Math.min(work.x + work.width - b.width, Math.round(p.x + (p.width - b.width) / 2)));
  const y = Math.max(work.y, Math.min(work.y + work.height - b.height, Math.round(p.y + (p.height - b.height) / 2)));
  a_win.setPosition(x, y);
}

/**
 * ダイアログを開いて、結果を待つ。
 * @param {BrowserWindow} a_parent 親のウィンドウ
 * @param {'table'|'link'|'pdfMargin'|'about'} a_kind 種類
 * @param {object} [a_data] ダイアログに渡す値（PDF の余白の今の値等）
 * @param {{ onReadme?: () => void }} [a_options] F1（Readme を開く）を押した時の処理
 * @returns {Promise<object|null>} 結果（キャンセル・閉じた時は null）
 */
function openDialog(a_parent, a_kind, a_data, a_options = {}) {
  return new Promise((resolve) => {
    const win = createWindow(a_parent, a_kind, a_data, true);
    const id = win.webContents.id;
    let done = false;
    const finish = (a_result) => {
      if (done) return;
      done = true;
      s_dialogs.delete(id);
      resolve(a_result);
      if (!win.isDestroyed()) win.close();
    };
    s_dialogs.set(id, {
      // 画面側の準備ができた：中身の高さに合わせて、親の中央に表示する
      ready: (a_height) => {
        win.setContentSize(KINDS[a_kind].width, Math.ceil(a_height));
        centerOnParent(win, a_parent);
        win.show();
      },
      result: (a_value) => finish(a_value),
      readme: () => a_options.onReadme?.(),
    });
    win.on('closed', () => finish(null));
  });
}

/** 検索と置換のウィンドウ（親のウィンドウごとに 1 つ。親を閉じると一緒に閉じる）。 */
class FindWindow {
  /**
   * @param {BrowserWindow} a_parent 親のウィンドウ
   * @param {{ onCommand: (a_command: object) => void, onReadme: () => void }} a_handlers 命令を親の画面側へ送る処理等
   */
  constructor(a_parent, a_handlers) {
    this.parent = a_parent;
    this.handlers = a_handlers;
    this.ready = false;
    this.pendingShow = null;
    this.folderAvailable = false;
    this.allowClose = false;
    this.win = createWindow(a_parent, 'find', {}, false);
    const id = this.win.webContents.id;
    s_dialogs.set(id, {
      ready: (a_height) => {
        this.ready = true;
        this.win.setContentSize(KINDS.find.width, Math.ceil(a_height));
        this.send('find-folder', this.folderAvailable);
        if (this.pendingShow) {
          const args = this.pendingShow;
          this.pendingShow = null;
          this.show(args);
        }
      },
      command: (a_command) => {
        this.handlers.onCommand(a_command);
        if ('close' === a_command.action) this.hide();
      },
      resize: (a_height) => {
        // 「すべて検索」で結果を表示した時等：中身に合わせた高さにする（幅は変えない）
        const [width] = this.win.getContentSize();
        this.win.setContentSize(width, Math.ceil(a_height));
        this.fitInWorkArea();
      },
      readme: () => this.handlers.onReadme(),
    });
    // 閉じる時：本当には閉じずに隠し、親の画面側に検索の色を消させる（親を閉じる時は本当に閉じる）
    this.win.on('close', (e) => {
      if (this.allowClose) return;
      e.preventDefault();
      this.handlers.onCommand({ action: 'close' });
      this.hide();
    });
    this.win.on('closed', () => s_dialogs.delete(id));
  }

  /**
   * 画面側へメッセージを送る。
   * @param {string} a_channel 種類
   * @param {unknown} a_value 値
   */
  send(a_channel, a_value) {
    if (!this.win.isDestroyed()) this.win.webContents.send(a_channel, a_value);
  }

  /**
   * 「フォルダ全体」を選べるかを、フォルダを開いているかに合わせる。
   * @param {boolean} a_available フォルダを開いているか
   */
  setFolderAvailable(a_available) {
    this.folderAvailable = a_available;
    if (this.ready) this.send('find-folder', a_available);
  }

  /**
   * 表示して前に出し、検索する文字列の欄を選択した状態にする。
   * @param {{ selectedText?: string }} a_args 編集領域で範囲選択していた文字列
   */
  show(a_args = {}) {
    if (!this.ready) {
      this.pendingShow = a_args;
      return;
    }
    if (!this.win.isVisible()) {
      this.placeBesideParent();
      this.win.show();
    }
    this.win.focus();
    this.send('find-show', { selectedText: a_args.selectedText || '' });
  }

  /** 隠して、親を前に出す。 */
  hide() {
    if (this.win.isDestroyed() || !this.win.isVisible()) return;
    this.win.hide();
    if (!this.parent.isDestroyed()) {
      this.parent.focus();
      this.parent.webContents.focus();
    }
  }

  /**
   * 親の画面側の処理の結果を表示する（findUpdate のメッセージ）。
   * @param {object} a_update status・results・selectedIndex・step
   */
  applyUpdate(a_update) {
    this.send('find-update', a_update);
  }

  /** 配色を合わせ直す。 */
  applyTheme() {
    this.send('dialog-theme', theme.isDark());
  }

  /** 本当に閉じる（親を閉じる時）。 */
  close() {
    this.allowClose = true;
    if (!this.win.isDestroyed()) this.win.close();
  }

  /**
   * 画面の作業領域の下にはみ出す時は、上へずらし、それでも入らない時は高さを縮める（結果の一覧が多い時。縮めた分は、
   * 結果の一覧をスクロールして見る）。
   */
  fitInWorkArea() {
    const b = this.win.getBounds();
    const work = screen.getDisplayMatching(b).workArea;
    const bottom = work.y + work.height;
    let { y, height } = b;
    if (y + height > bottom) y = Math.max(work.y, bottom - height);
    if (y + height > bottom) height = bottom - y;
    if (y !== b.y || height !== b.height) this.win.setBounds({ x: b.x, y, width: b.width, height });
  }

  /**
   * 親の横（右に空きがあれば右、無ければ親の右上の内側）に置く。上端は、親の上の端が少し見える位置。
   * 画面の作業領域からはみ出さないようにする。
   */
  placeBesideParent() {
    const p = this.parent.getBounds();
    const b = this.win.getBounds();
    const work = screen.getDisplayMatching(p).workArea;
    const margin = 12;
    const gap = 4;
    let x = Math.min(p.x + p.width, work.x + work.width) - margin - b.width;
    if (p.x + p.width < work.x + work.width) {
      x = Math.max(x, Math.min(p.x + p.width + gap, work.x + work.width - gap - b.width));
    }
    x = Math.max(x, work.x);
    let y = Math.max(p.y, work.y) + margin;
    const overflow = y + b.height - (work.y + work.height);
    if (overflow > 0) y -= Math.min(overflow, Math.max(0, y - work.y));
    this.win.setPosition(Math.round(x), Math.round(y));
  }
}

/** ダイアログの画面からのメッセージを受け取る処理を登録する（初めてダイアログを開く時に 1 回だけ）。 */
function registerIpc() {
  if (s_ipcRegistered) return;
  s_ipcRegistered = true;
  const handler = (a_name) => (a_event, a_value) => {
    const entry = s_dialogs.get(a_event.sender.id);
    if (entry && entry[a_name]) entry[a_name](a_value);
  };
  ipcMain.on('dialog-ready', handler('ready'));
  ipcMain.on('dialog-result', handler('result'));
  ipcMain.on('dialog-readme', handler('readme'));
  ipcMain.on('find-command', handler('command'));
  ipcMain.on('find-resize', handler('resize'));
}

/** 開いているダイアログに、配色の変更を知らせる。 */
function broadcastTheme() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (s_dialogs.has(win.webContents.id)) win.webContents.send('dialog-theme', theme.isDark());
  }
}

module.exports = { openDialog, FindWindow, broadcastTheme };
