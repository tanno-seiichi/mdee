// menu.js
//
// mdee の一部。メニューバーのメニュー（ファイル・表示・ヘルプ）を、Electron のメニュー（Menu.popup）で開く（mdew の
// ShowWebMenu の移植）。HTML のメニューはウィンドウの外へはみ出して表示できず、長いパスの「最近使ったファイル」等が
// 省略されてしまうため。項目は画面側で作り（web\js\main.js の MENUS）、選ばれた項目の番号を menuSelected で返す。
// 閉じたら menuClosed で知らせる。開いている間に別のメニューのボタンへマウスを移したら、閉じて menuSwitch で別の
// メニューを開いてもらう（Windows のメニューバーと同じ。マウスの位置は、短い間隔で調べる）。

'use strict';

const { Menu, MenuItem, screen } = require('electron');

/** 開いている間に、マウスの位置を調べる間隔（ms）。 */
const POLL_INTERVAL_MS = 30;

/**
 * 画面側の項目の表示（「Ctrl+N」等）を、Electron のショートカットの書き方にする（表示するだけで、登録はしない）。
 * @param {string} a_key 画面側の表示
 * @returns {string|undefined}
 */
function toAccelerator(a_key) {
  if (!a_key) return undefined;
  return a_key.replace(/\+\+$/, '+Plus').replace(/\+-$/, '+-');
}

/**
 * 項目を作る。
 * @param {object|null} a_item 画面側の項目（null：区切り線。label・key・checked・disabled・heading・submenu・id）
 * @param {(a_id: number) => void} a_onSelect 選ばれた時の処理
 * @returns {MenuItem}
 */
function buildItem(a_item, a_onSelect) {
  if (!a_item) return new MenuItem({ type: 'separator' });
  // 「&」はアクセスキーの印になるので、「&&」にして文字のまま表示する
  const label = String(a_item.label || '').replace(/&/g, '&&');
  if (a_item.heading) return new MenuItem({ label, enabled: false });
  const options = { label, enabled: !a_item.disabled };
  if (a_item.submenu) {
    options.submenu = Menu.buildFromTemplate([]);
    for (const child of a_item.submenu) options.submenu.append(buildItem(child, a_onSelect));
  } else {
    if (a_item.checked) {
      options.type = 'checkbox';
      options.checked = true;
    }
    const id = a_item.id;
    options.click = () => a_onSelect(id);
  }
  const accelerator = toAccelerator(a_item.key);
  if (accelerator) {
    try {
      return new MenuItem({ ...options, accelerator, registerAccelerator: false });
    } catch {
      // Electron で表せない書き方のショートカットは表示しない
    }
  }
  return new MenuItem(options);
}

/**
 * メニューを開く（showMenu のメッセージ）。開いているメニューがあれば、新しいメニューに置き換える。
 * @param {import('electron').BrowserWindow} a_win ウィンドウ
 * @param {object} a_msg showMenu のメッセージ（name・x・y・items・buttons・keyboard）
 * @param {(a_message: object) => void} a_post 画面側へメッセージを送る処理
 */
function showWebMenu(a_win, a_msg, a_post) {
  const state = a_win.mdeeMenuState || (a_win.mdeeMenuState = { current: null });
  const name = a_msg.name;
  if (state.current) {
    // 開いているメニューは、新しいメニューに置き換える（置き換えて閉じたメニューは、menuClosed を送らない）
    const old = state.current;
    old.replacedBy = name;
    old.menu.closePopup(a_win);
  }
  const menu = new Menu();
  for (const item of a_msg.items || []) menu.append(buildItem(item, (a_id) => a_post({ cmd: 'menuSelected', id: a_id })));
  const buttons = (a_msg.buttons || []).filter((b) => b && 'string' === typeof b.name);
  const entry = { menu, name, replacedBy: null, switchTo: null, timer: null };
  state.current = entry;

  // 開いている間、マウスが別のメニューのボタンの上に来たら、そのメニューに切り替える
  entry.timer = setInterval(() => {
    if (a_win.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    const content = a_win.getContentBounds();
    const x = point.x - content.x;
    const y = point.y - content.y;
    const target = buttons.find((b) => b.name !== name && x >= b.left && x < b.right && y >= b.top && y < b.bottom);
    if (target) {
      entry.switchTo = target.name;
      clearInterval(entry.timer);
      menu.closePopup(a_win);
    }
  }, POLL_INTERVAL_MS);

  menu.popup({
    window: a_win,
    x: Math.round(a_msg.x),
    y: Math.round(a_msg.y),
    callback: () => {
      clearInterval(entry.timer);
      if (state.current === entry) state.current = null;
      if (a_win.isDestroyed()) return;
      if (null !== entry.replacedBy) {
        // 別のメニューを開くために閉じた：同じメニューを開き直した時は、画面側のメニューの状態を消さない
        if (entry.replacedBy !== name) a_post({ cmd: 'menuClosed', name });
        return;
      }
      // 別のメニューへ切り替える時は、キーボードの入力先を画面に戻さない（すぐに次のメニューを開くため）
      const switchToMenu = entry.switchTo && buttons.some((b) => b.name === entry.switchTo && b.menu);
      if (!switchToMenu) a_win.webContents.focus();
      a_post({ cmd: 'menuClosed', name });
      if (entry.switchTo) a_post({ cmd: 'menuSwitch', name: entry.switchTo, keyboard: false });
    },
  });
}

module.exports = { showWebMenu };
