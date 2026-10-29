// clipboard.js
//
// mdee の一部。「Excel用にコピー」「表をコピー」で、HTML と文字をクリップボードに書き込む（mdew の CopyHtml の移植）。
// 画面側が書き込むと、HTML に元のページの場所が付き、Excel がインターネット上のページとして扱って PC の中の画像を
// 読み込まないため、ここで書き込む。画像（file:///…）は、mde と同じく一時フォルダへコピーしてから参照させる。

'use strict';

const { clipboard, app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL, fileURLToPath } = require('node:url');

/** Excel 等へ貼り付ける画像を置く一時フォルダ（コピーのたびに、10 分より古いものを消す）。 */
function clipboardTempDir() {
  return path.join(app.getPath('temp'), 'mdee', 'clipboard_images');
}

/**
 * HTML の特殊文字を戻す（&amp; 等）。
 * @param {string} a_text 文字列
 * @returns {string}
 */
function htmlDecode(a_text) {
  return a_text.replace(/&(amp|lt|gt|quot|#39);/g, (m, a_name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[a_name]);
}

/**
 * HTML の特殊文字を置き換える。
 * @param {string} a_text 文字列
 * @returns {string}
 */
function htmlEncode(a_text) {
  return a_text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Excel 等に貼り付ける画像を一時フォルダへコピーし、その file:/// の URL を返す（mde の ImageManager.
 * WriteTempFileForClipboard と同じ）。同じ画像を何か所に貼っても Excel が 1 つにまとめないよう、ファイルの末尾に無害な
 * バイトを足して中身を毎回変える（BMP を除く）。file:/// 以外・コピーできない場合は、そのまま返す。
 * @param {string} a_url 画像の参照先
 * @returns {string}
 */
function copyImageForClipboard(a_url) {
  try {
    if (!/^file:/i.test(a_url)) return a_url;
    const source = fileURLToPath(a_url);
    if (!fs.existsSync(source)) return a_url;
    const dir = clipboardTempDir();
    fs.mkdirSync(dir, { recursive: true });
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const name of fs.readdirSync(dir)) {
      try {
        const file = path.join(dir, name);
        if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
      } catch {
        // 使用中等で消せないファイルは、次の機会に消す
      }
    }
    const ext = path.extname(source).toLowerCase();
    const dest = path.join(dir, crypto.randomUUID().replace(/-/g, '') + ext);
    fs.copyFileSync(source, dest);
    if ('.bmp' !== ext) fs.appendFileSync(dest, crypto.randomBytes(16));
    return pathToFileURL(dest).href;
  } catch {
    return a_url;
  }
}

/**
 * HTML（表）と文字をクリップボードに書き込む。
 * @param {string} a_html HTML の断片
 * @param {string} a_text 文字（改行は LF）
 */
function copyHtml(a_html, a_text) {
  const html = (a_html || '').replace(/(<img\b[^>]*?\bsrc=")([^"]*)(")/gi,
    (m, a_head, a_src, a_tail) => a_head + htmlEncode(copyImageForClipboard(htmlDecode(a_src))) + a_tail);
  clipboard.write({ text: (a_text || '').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), html });
}

module.exports = { copyHtml };
