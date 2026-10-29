// theme.js
//
// mdee の一部。配色（ライト・ダーク）。メニュー「表示」→「テーマ」で、Windows の設定に合わせる・ライト・ダークを選ぶ
// （mdew の Theme.cs と同じ色）。Electron の nativeTheme.themeSource に入れると、タイトルバー・メニュー・ダイアログ
// （Windows のもの）も、その配色になる。編集画面（web\app.css の body.theme-dark）と、mdee のダイアログ・検索と置換の
// ウィンドウ（dialog\dialog.css）には、theme のメッセージで色を送る。

'use strict';

const { nativeTheme } = require('electron');

/** 選び方：Windows の設定に合わせる（既定）・ライト・ダーク。 */
const MODES = ['system', 'light', 'dark'];

/** 暗い配色の時の、編集画面の色（web\app.css の body.theme-dark の --vs-…）とメニューの色（mdew と同じ）。 */
const DARK_COLORS = Object.freeze({
  bg: '#1F1F1F', fg: '#E0E0E0', border: '#3C3C3C',
  menuBg: '#2B2B2B', menuFg: '#F0F0F0', menuBorder: '#454545', menuHover: '#094771', menuHoverFg: '#FFFFFF', menuSep: '#454545',
});

/**
 * 選び方を正しい値にする（不明な値は 'system'）。
 * @param {string} a_mode 選び方
 * @returns {string}
 */
function normalize(a_mode) {
  return MODES.includes(a_mode) ? a_mode : 'system';
}

/**
 * 選び方を決める（Electron の nativeTheme にも入れる）。
 * @param {string} a_mode 選び方
 */
function setMode(a_mode) {
  nativeTheme.themeSource = normalize(a_mode);
}

/** 今の選び方。 */
function mode() {
  return nativeTheme.themeSource;
}

/** 今、暗い配色か。 */
function isDark() {
  return nativeTheme.shouldUseDarkColors;
}

/** 画面の背景色（ウィンドウを表示する前・読み込み中に見える色）。 */
function background() {
  return isDark() ? DARK_COLORS.bg : '#FFFFFF';
}

/**
 * 画面側へ送る配色のメッセージ（mdew の Theme.CreateMessage と同じ）。
 * @returns {object}
 */
function createMessage() {
  return isDark() ? { cmd: 'theme', mode: mode(), dark: true, ...DARK_COLORS } : { cmd: 'theme', mode: mode(), dark: false };
}

/**
 * 配色が変わった時（テーマの選び方を変えた時・Windows の設定が変わった時）に呼ぶ処理を登録する。
 * @param {() => void} a_listener 処理
 */
function onChanged(a_listener) {
  nativeTheme.on('updated', a_listener);
}

module.exports = { normalize, setMode, mode, isDark, background, createMessage, onChanged };
