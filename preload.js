// preload.js
//
// mdee（Markdown Editor by Electron）の一部。
// 画面側（web\js\main.js）に、ホスト（メインプロセス。main.js）とのやり取りの窓口 window.mdeeHost を渡す。
// mdew の WebView2（window.chrome.webview）と同じ形（postMessage と、message の受け取り）にしてあるので、画面側は
// ほぼそのまま使える。メッセージは JSON の文字列（画面側の send 参照）。

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** message の受け取り先（画面側の host.addEventListener('message', …)）。 */
const listeners = [];

ipcRenderer.on('host-message', (a_event, a_data) => {
  for (const listener of listeners) {
    listener({ data: a_data });
  }
});

contextBridge.exposeInMainWorld('mdeeHost', {
  /** ホストへメッセージを送る（JSON の文字列）。 */
  postMessage: (a_text) => ipcRenderer.send('web-message', a_text),
  /** ホストからのメッセージを受け取る（a_type は 'message' だけ）。 */
  addEventListener: (a_type, a_listener) => {
    if ('message' === a_type) listeners.push(a_listener);
  },
});
