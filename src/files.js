// files.js
//
// mdee の一部。ファイルの読み書きと画像の扱い（mdew の Program.cs の LoadFile・SaveFile・RelocateTempImages・
// RelocateRelativeImages 等の移植）。
//  - 読み込み：UTF-8 の BOM の有無と改行の種類（CRLF・LF）を覚えておき、保存する時も同じにする。画面側へは、BOM を除き、
//    改行を LF にそろえて渡す。
//  - 貼り付けた画像：保存するまでは、ウィンドウごとの一時フォルダに置き（https://tmp.mdee/<ウィンドウの番号>/<ファイル名>）、
//    保存する時に、保存先の隣の「<ファイル名>.images」フォルダへ移して、参照先を相対パスに書き換える。
//  - 名前を付けて保存：保存先のフォルダ・ファイル名が変わる時は、相対パスの画像も新しい保存先へコピーする。

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** 画像として扱うファイルの拡張子と、その Content-Type。 */
const IMAGE_TYPES = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
});
/** Markdown ファイルとして扱う拡張子（フォルダビューの一覧・フォルダ全体の検索の対象。mde と同じ）。 */
const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];
/** 貼り付けた画像のファイル名の先頭（clipboard_image_1.png 等。mde と同じ）。 */
const PASTED_IMAGE_BASE_NAME = 'clipboard_image';
/** 貼り付けた画像の仮の URL の先頭（この後ろに <ウィンドウの番号>/<ファイル名>）。 */
const TMP_URL_PREFIX = 'https://tmp.mdee/';
/** 文書内の相対パスの画像の基準の URL の先頭（この後ろに <ウィンドウの番号>/<世代>/）。 */
const DOC_URL_PREFIX = 'https://doc.mdee/';

/** エクスプローラーに近い並べ方（数字を数として比べる。「2」は「10」より前）。 */
const s_collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

/**
 * パスを比べる（大文字・小文字を区別しない）。
 * @param {string} a_x パス
 * @param {string} a_y パス
 * @returns {boolean}
 */
function samePath(a_x, a_y) {
  return !!a_x && !!a_y && a_x.toLowerCase() === a_y.toLowerCase();
}

/**
 * 画像のファイルか（拡張子で判断する）。
 * @param {string} a_path パス
 * @returns {boolean}
 */
function isImageFile(a_path) {
  return Object.prototype.hasOwnProperty.call(IMAGE_TYPES, path.extname(a_path).toLowerCase());
}

/**
 * Markdown ファイルか（拡張子が .md・.markdown）。
 * @param {string} a_path パス
 * @returns {boolean}
 */
function isMarkdownFile(a_path) {
  return MARKDOWN_EXTENSIONS.includes(path.extname(a_path).toLowerCase());
}

/**
 * UTF-8 の BOM が付いているか。
 * @param {Buffer} a_bytes ファイルの内容
 * @returns {boolean}
 */
function hasBom(a_bytes) {
  return a_bytes.length >= 3 && 0xef === a_bytes[0] && 0xbb === a_bytes[1] && 0xbf === a_bytes[2];
}

/**
 * Markdown のファイルを読む（BOM の有無・改行の種類も返す）。
 * @param {string} a_path パス
 * @returns {{ text: string, bom: boolean, crlf: boolean }} text は BOM を除き、改行を LF にそろえたもの
 */
function readMarkdown(a_path) {
  const bytes = fs.readFileSync(a_path);
  const bom = hasBom(bytes);
  const raw = bytes.toString('utf8', bom ? 3 : 0);
  return { text: raw.replace(/\r\n/g, '\n'), bom, crlf: raw.includes('\r\n') };
}

/**
 * Markdown を書き出す（改行の種類・BOM の有無を指定する）。
 * @param {string} a_path パス
 * @param {string} a_markdown 内容（改行は LF）
 * @param {boolean} a_crlf 改行を CRLF にするか
 * @param {boolean} a_bom BOM を付けるか
 */
function writeMarkdown(a_path, a_markdown, a_crlf, a_bom) {
  const text = a_crlf ? a_markdown.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') : a_markdown;
  const body = Buffer.from(text, 'utf8');
  fs.writeFileSync(a_path, a_bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body);
}

/**
 * フォルダの直下のサブフォルダ（名前が「.」で始まるものは除く）と Markdown ファイルを、それぞれ名前の順に並べて返す
 * （mde の FolderTreeManager と同じ）。読めないフォルダは、読めた分だけを返す。
 * @param {string} a_dir フォルダのパス
 * @returns {{ dirs: string[], files: string[] }} フルパス
 */
function listMarkdownEntries(a_dir) {
  const dirs = [];
  const files = [];
  try {
    for (const entry of fs.readdirSync(a_dir, { withFileTypes: true })) {
      const full = path.join(a_dir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stat = fs.statSync(full);
          isDir = stat.isDirectory();
          isFile = stat.isFile();
        } catch {
          continue;
        }
      }
      if (isDir && !entry.name.startsWith('.')) dirs.push(full);
      else if (isFile && isMarkdownFile(entry.name)) files.push(full);
    }
  } catch {
    // 読めた分だけを返す
  }
  const byName = (a, b) => s_collator.compare(path.basename(a), path.basename(b));
  return { dirs: dirs.sort(byName), files: files.sort(byName) };
}

/**
 * フォルダ以下のすべての Markdown ファイルの内容を返す（フォルダ全体の検索・置換用。並びはフォルダビューと同じ）。
 * @param {string} a_root フォルダのパス
 * @returns {{ path: string, text: string }[]}
 */
function readFolderFiles(a_root) {
  const result = [];
  const walk = (a_dir) => {
    const { dirs, files } = listMarkdownEntries(a_dir);
    for (const d of dirs) walk(d);
    for (const f of files) {
      try {
        result.push({ path: f, text: readMarkdown(f).text });
      } catch {
        // 読めないファイルは飛ばす
      }
    }
  };
  walk(a_root);
  return result;
}

/**
 * フォルダ内で既存ファイルと重ならない「ベース名_連番.拡張子」を作る（連番は 1 から）。
 * @param {string} a_dir フォルダ
 * @param {string} a_baseName ファイル名の先頭
 * @param {string} a_ext 拡張子（「.」を含む）
 * @returns {string} ファイル名
 */
function sequentialFileName(a_dir, a_baseName, a_ext) {
  for (let i = 1; ; i++) {
    const name = `${a_baseName}_${i}${a_ext}`;
    if (!fs.existsSync(path.join(a_dir, name))) return name;
  }
}

/**
 * 貼り付けた画像の仮の URL の、ファイル名の部分（一時フォルダの中のファイル名）。
 * @param {string} a_url 仮の URL（https://tmp.mdee/<番号>/<ファイル名>）
 * @returns {string|null}
 */
function tempImageName(a_url) {
  if (!a_url.toLowerCase().startsWith(TMP_URL_PREFIX)) return null;
  const rest = a_url.slice(TMP_URL_PREFIX.length).split(/[?#]/)[0];
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  try {
    const name = path.basename(decodeURIComponent(rest.slice(slash + 1)));
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Markdown の中の画像の参照先を書き換える（画像記法 ![](参照先)・![](<参照先>)、HTML の src="参照先"、
 * リンク定義 [x]: 参照先 の形の箇所だけ。本文中に同じ文字列があっても書き換えない）。
 * @param {string} a_markdown Markdown
 * @param {string} a_oldSrc 変更前の参照先
 * @param {string} a_newSrc 変更後の参照先
 * @returns {string}
 */
function replaceImageReference(a_markdown, a_oldSrc, a_newSrc) {
  const needsAngle = /[ ()]/.test(a_newSrc);
  const dest = needsAngle ? `<${a_newSrc}>` : a_newSrc;
  let result = a_markdown
    .split(`](<${a_oldSrc}>`).join(`](${dest}`)
    .split(`](${a_oldSrc})`).join(`](${dest})`)
    .split(`](${a_oldSrc} `).join(`](${dest} `)
    .split(`src="${a_oldSrc}"`).join(`src="${a_newSrc}"`)
    .split(`src='${a_oldSrc}'`).join(`src='${a_newSrc}'`);
  // 空白を含むパスは、Markdown では %20 と書かれていることもある
  const encodedOld = a_oldSrc.replace(/ /g, '%20');
  if (encodedOld !== a_oldSrc) {
    const encodedNew = a_newSrc.replace(/ /g, '%20');
    result = result.split(`](${encodedOld})`).join(`](${encodedNew})`).split(`](${encodedOld} `).join(`](${encodedNew} `);
  }
  const escaped = a_oldSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return result.replace(new RegExp(`^(\\s*\\[[^\\]]+\\]:\\s*)${escaped}(?=\\s|$)`, 'gm'), (m, a_head) => a_head + dest);
}

/**
 * 保存する Markdown の中の、貼り付けた画像の仮の URL について、画像を保存先の隣の「<ファイル名>.images」フォルダへ
 * コピーし、URL をそのフォルダへの相対パスに書き換える（同名のファイルがあれば連番を付ける）。一時フォルダの画像は、
 * 保存後に「元に戻す」で仮の URL に戻った場合に備えて、ウィンドウを閉じるまで残しておく。
 * @param {string} a_markdown 保存する内容
 * @param {string} a_savePath 保存先のパス
 * @param {string} a_tempDir このウィンドウの一時フォルダ
 * @param {Record<string, string>} a_replacements 書き換えた URL の対応（仮の URL → 相対パス）を受け取る
 * @returns {string}
 */
function relocateTempImages(a_markdown, a_savePath, a_tempDir, a_replacements) {
  if (!a_markdown.includes(TMP_URL_PREFIX)) return a_markdown;
  const folderName = `${path.basename(a_savePath, path.extname(a_savePath))}.images`;
  const destDir = path.join(path.dirname(path.resolve(a_savePath)), folderName);
  const urls = a_markdown.match(/https:\/\/tmp\.mdee\/[^\s)>"']+/g) || [];
  let result = a_markdown;
  for (const url of urls) {
    if (Object.prototype.hasOwnProperty.call(a_replacements, url)) continue;
    const name = tempImageName(url);
    if (!name) continue;
    const src = path.join(a_tempDir, name);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(destDir, { recursive: true });
    let fileName = name;
    if (fs.existsSync(path.join(destDir, fileName))) {
      fileName = sequentialFileName(destDir, path.basename(name, path.extname(name)), path.extname(name));
    }
    fs.copyFileSync(src, path.join(destDir, fileName));
    const rel = `${folderName}/${fileName}`;
    a_replacements[url] = rel;
    // Markdown の画像記法では、空白や括弧を含むパスは <...> で囲む必要がある
    const dest = /[ ()]/.test(rel) ? `<${rel}>` : rel;
    result = result.split(`](${url})`).join(`](${dest})`).split(url).join(rel);
  }
  return result;
}

/**
 * 「名前を付けて保存」で保存先のフォルダやファイル名が変わる場合に、文書内の相対パスの画像を、新しい保存先から見て
 * 同じ相対パスの位置へコピーする（mdew の RelocateRelativeImages と同じ動き）。
 *  - 変更前のファイル専用の画像フォルダ「<変更前のファイル名>.images」の中の画像は、ファイル名も変わる場合、
 *    フォルダ名を「<新しいファイル名>.images」に変え、文中のパスも書き換える。
 *  - それ以外は、フォルダ名を変えずに同じ相対パスの構造でコピーする。コピー先に既にあれば上書きしない。
 *  - 絶対パス・http(s)・data: の画像、まだ保存していない画像（一時フォルダ）は対象外。
 * @param {string} a_markdown 保存する内容
 * @param {string|null} a_oldPath 変更前のパス（新規の文書は null）
 * @param {string} a_newPath 保存先のパス
 * @param {string[]} a_images 文書内の画像の参照先（画面側の collectImageSources が集めたもの）
 * @param {Record<string, string>} a_replacements 書き換えたパスの対応（変更前 → 変更後）を受け取る
 * @returns {string}
 */
function relocateRelativeImages(a_markdown, a_oldPath, a_newPath, a_images, a_replacements) {
  if (!a_oldPath || !a_images || !a_images.length) return a_markdown;
  const oldDir = path.dirname(path.resolve(a_oldPath));
  const newDir = path.dirname(path.resolve(a_newPath));
  const sameFolder = samePath(oldDir, newDir);
  const oldOwned = `${path.basename(a_oldPath, path.extname(a_oldPath))}.images`;
  const newOwned = `${path.basename(a_newPath, path.extname(a_newPath))}.images`;
  const renameOwned = !samePath(oldOwned, newOwned);
  if (sameFolder && !renameOwned) return a_markdown;
  let result = a_markdown;
  for (const src of a_images) {
    if (!src || /^data:/i.test(src) || src.startsWith('//') || path.isAbsolute(src) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) {
      continue; // http(s)・file:・一時フォルダの画像・絶対パス等
    }
    let relSrc = src.split(/[?#]/)[0].replace(/[\\/]/g, path.sep);
    if (!fs.existsSync(path.join(oldDir, relSrc))) {
      try {
        relSrc = decodeURIComponent(relSrc);
      } catch {
        // そのまま
      }
    }
    let destRel = relSrc;
    const first = relSrc.split(path.sep)[0];
    if (renameOwned && samePath(first, oldOwned)) destRel = newOwned + relSrc.slice(first.length);
    const relChanged = !samePath(relSrc, destRel);
    if (sameFolder && !relChanged) continue;
    const fullSrc = path.resolve(oldDir, relSrc);
    const fullDest = path.resolve(newDir, destRel);
    if (samePath(fullSrc, fullDest)) continue;
    if (!fs.existsSync(fullDest)) {
      if (!fs.existsSync(fullSrc)) continue;
      fs.mkdirSync(path.dirname(fullDest), { recursive: true });
      fs.copyFileSync(fullSrc, fullDest);
    }
    if (relChanged) {
      const newSrc = destRel.split(path.sep).join('/');
      a_replacements[src] = newSrc;
      result = replaceImageReference(result, src, newSrc);
    }
  }
  return result;
}

module.exports = {
  IMAGE_TYPES, PASTED_IMAGE_BASE_NAME, TMP_URL_PREFIX, DOC_URL_PREFIX,
  samePath, isImageFile, isMarkdownFile, readMarkdown, writeMarkdown, listMarkdownEntries, readFolderFiles,
  sequentialFileName, tempImageName, replaceImageReference, relocateTempImages, relocateRelativeImages,
};
