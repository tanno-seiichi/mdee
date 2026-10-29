// settings.js
//
// mdee の一部。次回起動時に引き継ぐ設定（ウィンドウの位置・大きさ、PDF の余白、最近使ったファイル・フォルダ、テーマ）。
// %LOCALAPPDATA%\mdee\settings.json に置き、すべてのウィンドウで同じものを使う。読み書きのたびにファイルを読み直す
// （ほかのウィンドウで変えた設定を消さないように。mdew の AppSettings と同じ考え方）。

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** PDF の余白の既定値（px。1px = 1/96 インチ。mde・mdew と同じ）。 */
const PDF_MARGIN_DEFAULTS = Object.freeze({ top: 64, bottom: 64, left: 80, right: 80 });
/** 最近使ったファイル・フォルダとして覚えておく数（mde と同じ）。 */
const MAX_RECENT = 10;

/** 設定ファイルのパス（setDataDir で決める）。 */
let s_path = null;

/**
 * 設定ファイルを置くフォルダを決める。
 * @param {string} a_dir フォルダ（%LOCALAPPDATA%\mdee）
 */
function setDataDir(a_dir) {
  s_path = path.join(a_dir, 'settings.json');
}

/**
 * 設定の既定値。
 * @returns {object}
 */
function defaults() {
  return {
    window: null, // { x, y, width, height }（最大化する前の位置・大きさ。画面の座標）
    isMaximized: false,
    pdfMargin: { ...PDF_MARGIN_DEFAULTS },
    recentFiles: [],
    recentFolders: [],
    theme: 'system', // 'system'・'light'・'dark'
  };
}

/**
 * 設定を読む（無い・読めない時は既定値）。
 * @returns {object}
 */
function load() {
  const result = defaults();
  try {
    const data = JSON.parse(fs.readFileSync(s_path, 'utf8'));
    if (data && 'object' === typeof data) {
      if (data.window && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(data.window[k]))) result.window = data.window;
      result.isMaximized = true === data.isMaximized;
      if (data.pdfMargin && 'object' === typeof data.pdfMargin) {
        for (const k of Object.keys(PDF_MARGIN_DEFAULTS)) {
          if (Number.isFinite(data.pdfMargin[k])) result.pdfMargin[k] = data.pdfMargin[k];
        }
      }
      if (Array.isArray(data.recentFiles)) result.recentFiles = data.recentFiles.filter((p) => 'string' === typeof p);
      if (Array.isArray(data.recentFolders)) result.recentFolders = data.recentFolders.filter((p) => 'string' === typeof p);
      if (['system', 'light', 'dark'].includes(data.theme)) result.theme = data.theme;
    }
  } catch {
    // 無い・壊れている時は既定値
  }
  return result;
}

/**
 * 設定を保存する。
 * @param {object} a_settings 設定
 */
function save(a_settings) {
  try {
    fs.mkdirSync(path.dirname(s_path), { recursive: true });
    const temp = `${s_path}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(a_settings, null, 2), 'utf8');
    fs.renameSync(temp, s_path);
  } catch {
    // 保存できなくても動作には影響しない
  }
}

/**
 * 設定を読み直して書き換え、保存する（ほかのウィンドウで変えた設定を消さないように）。
 * @param {(a_settings: object) => void} a_change 書き換える処理
 * @returns {object} 保存した設定
 */
function update(a_change) {
  const settings = load();
  a_change(settings);
  save(settings);
  return settings;
}

/**
 * 一覧の先頭にパスを加える（既にあれば先頭へ移す。大文字・小文字は区別しない。多すぎる分は古いものから消す）。
 * @param {string[]} a_list 一覧
 * @param {string} a_path パス
 */
function addRecent(a_list, a_path) {
  const key = a_path.toLowerCase();
  for (let i = a_list.length - 1; i >= 0; i--) {
    if (a_list[i].toLowerCase() === key) a_list.splice(i, 1);
  }
  a_list.unshift(a_path);
  if (a_list.length > MAX_RECENT) a_list.length = MAX_RECENT;
}

/**
 * 一覧からパスを消す（大文字・小文字は区別しない）。
 * @param {string[]} a_list 一覧
 * @param {string} a_path パス
 */
function removeRecent(a_list, a_path) {
  const key = a_path.toLowerCase();
  for (let i = a_list.length - 1; i >= 0; i--) {
    if (a_list[i].toLowerCase() === key) a_list.splice(i, 1);
  }
}

module.exports = { PDF_MARGIN_DEFAULTS, setDataDir, load, save, update, addRecent, removeRecent };
