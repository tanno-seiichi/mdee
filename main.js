// main.js
//
// mdee（Markdown Editor by Electron）のメインプロセスの入口。mdew（Markdown Editor by WebView2）を Electron で作り直した
// もの。画面（web フォルダ）は mdew と同じで、ファイル操作等の OS とのやり取りを src フォルダの処理が担当する。
//  - アプリは 1 つのプロセスで動かし、2 つ目に起動された時（ファイルのダブルクリック等）は、1 つ目のプロセスで新しい
//    ウィンドウを開く（新しいウィンドウを速く開けるように）。
//  - 作業用のデータ（設定・ログ・ブラウザのキャッシュ等）は %LOCALAPPDATA%\mdee に置く（ローミングしない場所）。
//  - 起動時間を記録する時は、環境変数 MDEE_TRACE_LOG=1 を付けて起動する（%LOCALAPPDATA%\mdee\error.log。src\log.js）。

'use strict';

const log = require('./src/log');

// 起動時間の記録：プロセスの開始時刻を基準にする
log.setProcessStart((typeof process.getCreationTime === 'function' && process.getCreationTime()) || Date.now());
log.mark('Main');

const { app, ipcMain } = require('electron');
const path = require('node:path');
const settings = require('./src/settings');

const dataDir = path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'mdee');
app.setPath('userData', dataDir);
log.configure(dataDir, '1' === process.env.MDEE_TRACE_LOG || process.argv.includes('--trace-log'));
settings.setDataDir(dataDir);
// タスクバーでの、まとまりの名前（スタートメニューのショートカットと同じにする。msi\File.wxs）
app.setAppUserModelId('tanno-seiichi.mdee');

/**
 * 起動時引数から、開くファイル・フォルダのパスを得る（相対パスは、起動した時の作業フォルダ基準で絶対パスにする）。
 * @param {string[]} a_argv 起動時引数（process.argv の形）
 * @param {string} a_cwd 起動した時の作業フォルダ
 * @returns {string|null}
 */
function startupPathFrom(a_argv, a_cwd) {
  // 「-」で始まるもの（Chromium・Electron の設定）は除く。開発中（electron .）は、最初のものがアプリのフォルダ
  const args = a_argv.slice(1).filter((a) => a && !a.startsWith('-'));
  if (!app.isPackaged) args.shift();
  const arg = args[0];
  if (!arg) return null;
  return path.resolve(a_cwd, arg.trim().replace(/^"|"$/g, ''));
}

if (!app.requestSingleInstanceLock({ argv: process.argv, cwd: process.cwd() })) {
  // 既に起動している：そのプロセスに、新しいウィンドウを開いてもらって終わる（second-instance）
  app.quit();
} else {
  log.trace(`起動（v${app.getVersion()}）`);
  process.on('uncaughtException', (ex) => log.error('想定外のエラー', ex));
  process.on('unhandledRejection', (ex) => log.error('非同期処理の想定外のエラー', ex));

  app.whenReady().then(() => {
    log.mark('Electronの準備');
    const theme = require('./src/theme');
    const { openWindow, fromWebContents, imageSourceOf, broadcastTheme } = require('./src/appWindow');
    theme.setMode(settings.load().theme);
    // 文書内の画像を、画面側へ返す（src\protocol.js）
    require('./src/protocol').register(imageSourceOf);
    // 画面側からのメッセージ（JSON の文字列。preload.js の postMessage）を、そのウィンドウで処理する
    ipcMain.on('web-message', (a_event, a_text) => {
      const win = fromWebContents(a_event.sender.id);
      if (!win) return;
      let msg;
      try {
        msg = JSON.parse(a_text);
      } catch {
        return;
      }
      win.handleMessage(msg).catch((ex) => {
        log.error('画面側からのメッセージの処理中にエラー', ex);
        win.postError(`処理中にエラーが発生しました。\n${ex.message}`);
      });
    });
    // Windows の設定（ライト・ダーク）が変わった時
    theme.onChanged(broadcastTheme);
    // 2 つ目に起動された時：このプロセスで新しいウィンドウを開く
    app.on('second-instance', (a_event, a_argv, a_cwd, a_data) => {
      const argv = a_data && Array.isArray(a_data.argv) ? a_data.argv : a_argv;
      const cwd = a_data && 'string' === typeof a_data.cwd ? a_data.cwd : a_cwd;
      openWindow({ startupPath: startupPathFrom(argv, cwd) });
    });
    openWindow({ startupPath: startupPathFrom(process.argv, process.cwd()), measureStartup: true });
  });

  app.on('window-all-closed', () => app.quit());
  app.on('quit', () => log.trace('終了'));
}
