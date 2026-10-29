// package.js
//
// mdee の一部。配布用のフォルダ（out\mdee）を作る（npm run package）。MSI（msi フォルダ）は、このフォルダの中身を
// そのまま入れる。
//  - Electron 本体（node_modules\electron\dist。npm install で取得したもの）をコピーし、electron.exe を mdee.exe に
//    名前を変えて、アイコン・バージョン情報（ファイルのプロパティの「詳細」）を書き換える（resedit。Windows 以外でも動く）。
//  - アプリ（main.js・src・web・dialog 等）は resources\app に置く（asar にはまとめない。ファイルの数が少ないので、
//    読み込みの速さはほとんど変わらず、インストールした後も中身を確かめやすい）。
//  - Chromium の画面の文言のファイル（locales\*.pak）は、日本語と英語だけを残す（大きさを減らすため）。
//  - Electron・Chromium のライセンス（LICENSE・LICENSES.chromium.html）は消さずに残す。
//
// 使い方：node tools/package.js（Electron 本体の場所を変える時は、環境変数 ELECTRON_DIST に指定する）

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** mdee のフォルダ。 */
const ROOT = path.join(__dirname, '..');
/** 作るフォルダ。 */
const OUT_DIR = path.join(ROOT, 'out', 'mdee');
/** Electron 本体のフォルダ。 */
const ELECTRON_DIST = process.env.ELECTRON_DIST || path.join(ROOT, 'node_modules', 'electron', 'dist');
/** resources\app に入れるもの（mdee のフォルダからの相対パス）。 */
const APP_FILES = ['main.js', 'preload.js', 'src', 'dialog', 'web', 'images', 'README.md', 'LICENSE.txt'];
/** 残す locales\*.pak（Chromium の画面の文言。それ以外は消す）。 */
const KEEP_LOCALES = new Set(['ja.pak', 'en-US.pak']);

/**
 * バージョンを、Windows のファイルのバージョンの形（4 つの数）にする。
 * @param {string} a_version package.json の version（例：0.1.0）
 * @returns {number[]}
 */
function versionNumbers(a_version) {
  const nums = String(a_version).split(/[.+-]/).slice(0, 4).map((s) => parseInt(s, 10) || 0);
  while (nums.length < 4) nums.push(0);
  return nums;
}

/**
 * mdee.exe のアイコンとバージョン情報を書き換える。
 * @param {string} a_exe mdee.exe のパス
 * @param {object} a_pkg package.json の内容
 */
async function updateExeResources(a_exe, a_pkg) {
  const ResEdit = await import('resedit');
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(a_exe), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  // アイコン：Electron のアイコン（グループ 1）を、mdee のアイコンに置き換える
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(ROOT, 'images', 'mde.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length > 0 ? groups[0].id : 1;
  const lang = groups.length > 0 ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));

  // バージョン情報
  const [major, minor, patch, build] = versionNumbers(a_pkg.version);
  const infos = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = infos.length > 0 ? infos[0] : ResEdit.Resource.VersionInfo.createEmpty();
  vi.setFileVersion(major, minor, patch, build, 1033);
  vi.setProductVersion(major, minor, patch, build, 1033);
  const strings = {
    CompanyName: a_pkg.author,
    FileDescription: a_pkg.description,
    FileVersion: a_pkg.version,
    InternalName: 'mdee',
    LegalCopyright: a_pkg.copyright,
    OriginalFilename: 'mdee.exe',
    ProductName: a_pkg.productName,
    ProductVersion: a_pkg.version,
  };
  const langs = vi.getAllLanguagesForStringValues();
  for (const l of langs.length > 0 ? langs : [{ lang: 1033, codepage: 1200 }]) {
    vi.setStringValues(l, strings);
    // Electron の Squirrel（インストーラー）用の印は使わないので消す
    vi.removeStringValue(l, 'SquirrelAwareVersion');
  }
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(a_exe, Buffer.from(exe.generate()));
}

/**
 * 配布用の package.json（開発用の項目を除いたもの）を作る。
 * @param {object} a_pkg package.json の内容
 * @returns {string}
 */
function appPackageJson(a_pkg) {
  const { devDependencies, scripts, ...rest } = a_pkg;
  return `${JSON.stringify(rest, null, 2)}\n`;
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const electronExe = path.join(ELECTRON_DIST, 'electron.exe');
  if (!fs.existsSync(electronExe)) {
    throw new Error(`Electron 本体（Windows 用）が見つかりません：${electronExe}\n` +
      'npm install と node node_modules\\electron\\install.js を実行してください。');
  }

  console.log(`mdee v${pkg.version} を ${path.relative(ROOT, OUT_DIR)} に作ります`);
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(OUT_DIR), { recursive: true });
  fs.cpSync(ELECTRON_DIST, OUT_DIR, { recursive: true });

  // electron.exe → mdee.exe
  const exe = path.join(OUT_DIR, 'mdee.exe');
  fs.renameSync(path.join(OUT_DIR, 'electron.exe'), exe);
  await updateExeResources(exe, pkg);

  // Electron の既定のアプリ（resources\default_app.asar）は使わない
  fs.rmSync(path.join(OUT_DIR, 'resources', 'default_app.asar'), { force: true });

  // 使わない locales
  const localesDir = path.join(OUT_DIR, 'locales');
  for (const name of fs.existsSync(localesDir) ? fs.readdirSync(localesDir) : []) {
    if (!KEEP_LOCALES.has(name)) fs.rmSync(path.join(localesDir, name), { force: true });
  }

  // アプリ
  const appDir = path.join(OUT_DIR, 'resources', 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const rel of APP_FILES) {
    fs.cpSync(path.join(ROOT, rel), path.join(appDir, rel), { recursive: true });
  }
  fs.writeFileSync(path.join(appDir, 'package.json'), appPackageJson(pkg));

  // 作ったもののファイルの数と大きさを表示する
  let count = 0;
  let bytes = 0;
  const walk = (a_dir) => {
    for (const ent of fs.readdirSync(a_dir, { withFileTypes: true })) {
      const p = path.join(a_dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else {
        count += 1;
        bytes += fs.statSync(p).size;
      }
    }
  };
  walk(OUT_DIR);
  console.log(`完了：${count} ファイル、${(bytes / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((ex) => {
  console.error(ex.message || ex);
  process.exitCode = 1;
});
