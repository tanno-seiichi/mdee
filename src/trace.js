// trace.js
//
// mdee の一部。開発用：動作の記録（Chromium のトレース）を取る（入力の遅れ・日本語入力の重さ等の原因を調べるため）。
// 開発用の起動（npm start・dev.cmd）か、環境変数 MDEE_DEBUG=1 の時に、Ctrl+Shift+F11 で始め、もう一度押すと止めて、
// %LOCALAPPDATA%\mdee\trace-<日時>.json に保存する（Chrome の chrome://tracing・Perfetto で開ける）。

'use strict';

const { app, contentTracing } = require('electron');
const path = require('node:path');
const log = require('./log');

/** 記録する種類（画面の描画・入力・IME・プロセス間のやり取り・JavaScript）。 */
const CATEGORIES = [
  'toplevel', 'blink', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'input', 'ime', 'ui', 'views',
  'mojom', 'ipc', 'renderer.scheduler', 'v8', 'cc', 'viz', 'benchmark', 'browser', 'disabled-by-default-ime',
];

/** 記録中か。 */
let s_recording = false;

/** 記録を始める・止める（止めた時はファイルに保存する）。 */
async function toggle() {
  if (!s_recording) {
    s_recording = true;
    await contentTracing.startRecording({ included_categories: CATEGORIES });
    log.trace('トレースの記録を開始（Ctrl+Shift+F11 で止める）');
    return;
  }
  s_recording = false;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
  const file = await contentTracing.stopRecording(path.join(app.getPath('userData'), `trace-${stamp}.json`));
  log.trace(`トレースを保存：${file}`);
}

module.exports = { toggle };
