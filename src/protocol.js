// protocol.js
//
// mdee の一部。文書内の画像を、画面側へ返す（mdew の ServeDocumentResource の移植）。
//  - https://doc.mdee/<ウィンドウの番号>/<世代>/<相対パス>：開いているファイルのフォルダ基準で、画像のファイルを返す
//    （画面側は、この URL を <base href> にして、相対パスの画像を読み込む。世代は、ファイルを開き直すたびに変えて、
//    別のフォルダの同じ名前の画像がキャッシュから表示されないようにするためのもの）。
//  - https://tmp.mdee/<ウィンドウの番号>/<ファイル名>：そのウィンドウの一時フォルダの、貼り付けた画像を返す。
// それ以外の https は、そのまま読み込む（文書内のインターネット上の画像）。画像以外・存在しないファイルは 404 にする。

'use strict';

const { protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { IMAGE_TYPES } = require('./files');

/**
 * 画像を返す処理を登録する（app の ready の後に呼ぶ）。
 * @param {(a_id: number) => ({ docFolder: string|null, tempDir: string }|null)} a_findWindow ウィンドウの番号から、
 *   そのウィンドウの文書のフォルダ・一時フォルダを得る処理
 */
function register(a_findWindow) {
  protocol.handle('https', async (a_request) => {
    let url;
    try {
      url = new URL(a_request.url);
    } catch {
      return new Response(null, { status: 400 });
    }
    const host = url.hostname.toLowerCase();
    if ('doc.mdee' !== host && 'tmp.mdee' !== host) {
      return net.fetch(a_request, { bypassCustomProtocolHandlers: true });
    }
    try {
      const parts = url.pathname.split('/').filter((p) => p.length).map((p) => decodeURIComponent(p));
      const win = a_findWindow(Number(parts[0]));
      if (!win) return notFound();
      let full = null;
      if ('tmp.mdee' === host) {
        // 一時フォルダの外は参照させない（ファイル名だけを使う）
        const name = path.basename(parts.slice(1).join('/'));
        if (name) full = path.join(win.tempDir, name);
      } else if (win.docFolder && parts.length > 2) {
        // ![](C:/dir/a.png) のような絶対パスは、そのまま使う（path.resolve は絶対パスを優先する）
        full = path.resolve(win.docFolder, parts.slice(2).join(path.sep));
      }
      const type = full ? IMAGE_TYPES[path.extname(full).toLowerCase()] : null;
      if (!type) return notFound();
      // 読み込みは非同期で行う（メインプロセスを止めない。大きな画像・ネットワーク上のフォルダの画像を読む間も、
      // キー入力・ウィンドウの操作が遅れないように。メインプロセスは、画面への入力の受け渡しも行っているため）
      const stat = await fs.promises.stat(full).catch(() => null);
      if (!stat || !stat.isFile()) return notFound();
      return new Response(await fs.promises.readFile(full), {
        status: 200,
        headers: { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' },
      });
    } catch {
      return new Response(null, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }
  });
}

/** 404 の返事。 */
function notFound() {
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

module.exports = { register };
