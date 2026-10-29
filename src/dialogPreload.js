// dialogPreload.js
//
// mdee の一部。ダイアログ・検索と置換のウィンドウの画面（dialog\dialog.js）に、メインプロセスとのやり取りの窓口
// window.mdeeDialog を渡す（src\dialogs.js 参照）。

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * メインプロセスからのメッセージを受け取る処理を登録する。
 * @param {string} a_channel 種類
 * @returns {(a_listener: (a_value: unknown) => void) => void}
 */
const on = (a_channel) => (a_listener) => ipcRenderer.on(a_channel, (a_event, a_value) => a_listener(a_value));

contextBridge.exposeInMainWorld('mdeeDialog', {
  /** 画面の準備ができた（中身の高さを知らせる。メインプロセスが大きさを合わせて表示する）。 */
  ready: (a_height) => ipcRenderer.send('dialog-ready', a_height),
  /** ダイアログの結果（キャンセルは null）。 */
  result: (a_value) => ipcRenderer.send('dialog-result', a_value),
  /** F1：Readme を開く。 */
  readme: () => ipcRenderer.send('dialog-readme'),
  /** 検索と置換：ボタンが押された（action と、入力された内容）。 */
  findCommand: (a_command) => ipcRenderer.send('find-command', a_command),
  /** 検索と置換：中身の高さが変わった。 */
  findResize: (a_height) => ipcRenderer.send('find-resize', a_height),
  /** 検索と置換：表示された（selectedText）。 */
  onFindShow: on('find-show'),
  /** 検索と置換：親の画面側の処理の結果（status・results・selectedIndex・step）。 */
  onFindUpdate: on('find-update'),
  /** 検索と置換：「フォルダ全体」を選べるか。 */
  onFindFolder: on('find-folder'),
  /** 配色が変わった（暗い配色か）。 */
  onTheme: on('dialog-theme'),
});
