// log.js
//
// mdee の一部。エラー・起動・終了の記録（%LOCALAPPDATA%\mdee\error.log。mdew と同じ形式）と、起動時間の記録。
// 起動・終了・起動時間の記録は、記録する設定の時だけ書く（traceEnabled。package.json の mdee.traceLog、または
// 環境変数 MDEE_TRACE_LOG=1）。エラーは常に書く（エラーが無ければ error.log は作らない）。1MB を超えたら作り直す。

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** 記録するファイルの最大の大きさ（これを超えたら作り直す）。 */
const MAX_LOG_SIZE = 1024 * 1024;

/** 記録するフォルダ（setDataDir で決める）。 */
let s_dir = null;
/** 起動・終了・起動時間も記録するか。 */
let s_trace = false;

/**
 * 記録するフォルダと、起動・終了等も記録するかを決める。
 * @param {string} a_dir フォルダ（%LOCALAPPDATA%\mdee）
 * @param {boolean} a_trace 起動・終了・起動時間も記録するか
 */
function configure(a_dir, a_trace) {
  s_dir = a_dir;
  s_trace = a_trace;
}

/** 起動・終了・起動時間も記録するか。 */
function traceEnabled() {
  return s_trace;
}

/** 記録するファイルのパス。 */
function logPath() {
  return path.join(s_dir || '.', 'error.log');
}

/**
 * 1 行書く（時刻・プロセス番号を付ける）。
 * @param {string} a_text 内容
 */
function writeLine(a_text) {
  const now = new Date();
  const pad = (a_value, a_length = 2) => String(a_value).padStart(a_length, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
  try {
    fs.mkdirSync(s_dir, { recursive: true });
    const file = logPath();
    try {
      if (fs.statSync(file).size > MAX_LOG_SIZE) fs.unlinkSync(file);
    } catch {
      // まだ無い
    }
    fs.appendFileSync(file, `${stamp} [${process.pid}] ${a_text}\r\n`, 'utf8');
  } catch {
    // 書けなくても動作には影響しない
  }
}

/**
 * 動作の記録（起動・終了等。エラーではないもの）を 1 件書く（記録する設定の時だけ）。
 * @param {string} a_text 内容
 */
function trace(a_text) {
  if (s_trace) writeLine(a_text);
}

/**
 * エラーを 1 件書く。
 * @param {string} a_text 内容
 * @param {unknown} [a_error] 例外
 */
function error(a_text, a_error) {
  const detail = a_error ? ` ${a_error instanceof Error ? (a_error.stack || a_error.message) : String(a_error)}` : '';
  writeLine(`${a_text}${detail}`);
}

// ===== 起動時間 =====

/** プロセスの開始時刻（1970-01-01 からの ms）。 */
let s_processStart = Date.now();
/** 起動時間の記録（名前と、プロセスの開始からの時間（ms））。 */
const s_marks = [];
/** 記録し終えたか。 */
let s_finished = false;

/**
 * プロセスの開始時刻を決める（main.js の最初で呼ぶ）。
 * @param {number} a_time 1970-01-01 からの ms
 */
function setProcessStart(a_time) {
  s_processStart = a_time;
}

/**
 * 今の時点（または指定の時刻）を、起動時間の記録に加える。
 * @param {string} a_name 時点の名前
 * @param {number} [a_time] 時刻（1970-01-01 からの ms。省略時は今）
 */
function mark(a_name, a_time = Date.now()) {
  if (!s_finished) s_marks.push([a_name, a_time - s_processStart]);
}

/** 起動時間を 1 行で書く（記録する設定の時だけ。2 回目以降は何もしない）。 */
function finish() {
  if (s_finished) return;
  s_finished = true;
  const text = s_marks
    .slice()
    .sort((a, b) => a[1] - b[1])
    .map(([name, ms]) => `${name}=${Math.round(ms)}ms`)
    .join(' ');
  trace(`起動時間：${text}`);
}

/** 起動時間を記録し終えたか。 */
function finished() {
  return s_finished;
}

module.exports = { configure, traceEnabled, trace, error, setProcessStart, mark, finish, finished, logPath };
