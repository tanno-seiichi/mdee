// dialog.js
//
// mdee：ダイアログ（表を挿入・リンク・PDF の余白・バージョン情報）と、検索と置換のウィンドウの画面（mdew の
// dialog\*.xaml と同じ項目・動き）。種類と初めの値は、URL の kind・data で受け取る（src\dialogs.js）。
// メインプロセスとは window.mdeeDialog（src\dialogPreload.js）でやり取りする。

'use strict';

(() => {
  const host = window.mdeeDialog;
  const params = new URLSearchParams(location.search);
  const kind = params.get('kind');
  let data = {};
  try {
    data = JSON.parse(params.get('data') || '{}');
  } catch {
    data = {};
  }
  const root = document.getElementById('root');

  /** 配色を合わせる（暗い配色の時は body に dark を付ける）。 */
  const applyTheme = (a_dark) => document.body.classList.toggle('dark', !!a_dark);
  applyTheme('1' === params.get('dark'));
  host?.onTheme(applyTheme);

  /**
   * 要素を作る。
   * @param {string} a_tag タグ
   * @param {object} [a_props] 属性（className・textContent 等）
   * @param {(Node|string)[]} [a_children] 子
   * @returns {HTMLElement}
   */
  function el(a_tag, a_props = {}, a_children = []) {
    const e = document.createElement(a_tag);
    for (const [key, value] of Object.entries(a_props)) {
      if ('dataset' === key) Object.assign(e.dataset, value);
      else if (key in e) e[key] = value;
      else e.setAttribute(key, value);
    }
    for (const child of a_children) e.append(child);
    return e;
  }

  /**
   * 入力欄（見出し付き）を作る。
   * @param {string} a_caption 見出し
   * @param {string} a_value 初めの値
   * @returns {{ caption: HTMLElement, input: HTMLInputElement }}
   */
  function field(a_caption, a_value) {
    return { caption: el('div', { className: 'caption', textContent: a_caption }), input: el('input', { type: 'text', value: a_value }) };
  }

  /** 結果を返して閉じる（キャンセルは null）。 */
  let finished = false;
  const finish = (a_value) => {
    if (finished) return;
    finished = true;
    host?.result(a_value);
  };

  /**
   * ボタンの並び（キャンセル・OK 等）を作る。Enter で OK、Esc でキャンセルにする。
   * @param {{ label: string, run: () => void, isDefault?: boolean, className?: string }[]} a_buttons ボタン
   * @returns {HTMLElement}
   */
  function buttonRow(a_buttons) {
    const row = el('div', { className: 'buttons' });
    for (const b of a_buttons) {
      const button = el('button', { type: 'button', textContent: b.label, className: `${b.isDefault ? 'default' : ''} ${b.className || ''}` });
      button.addEventListener('click', b.run);
      row.append(button);
    }
    return row;
  }

  /**
   * 入力された文字を、範囲の整数にする（数字でなければ 1。mde と同じ）。
   * @param {string} a_text 入力された文字
   * @param {number} a_max 最大値
   * @returns {number}
   */
  const clampCount = (a_text, a_max) => {
    const value = Number.parseInt(a_text, 10);
    if (!Number.isFinite(value) || value < 1 || !/^\s*\d+\s*$/.test(a_text)) return 1;
    return Math.min(value, a_max);
  };

  /**
   * 入力された余白を数にする（数字でなければ既定値。0〜300 に収める。mde と同じ）。
   * @param {string} a_text 入力された文字
   * @param {number} a_default 既定値
   * @returns {number}
   */
  const parseMargin = (a_text, a_default) => {
    const value = /^\s*[-+]?\d*\.?\d+(e[-+]?\d+)?\s*$/i.test(a_text) ? Number(a_text) : a_default;
    return Math.max(0, Math.min(300, value));
  };

  /** 最初に選択する入力欄。 */
  let firstInput = null;
  /** Enter で実行する処理（OK・挿入）。 */
  let onEnter = null;

  if ('table' === kind) {
    // 表を挿入：行数（見出し行を含む）は 1〜50、列数は 1〜20（mde と同じ）
    document.title = '表を挿入';
    const rows = field('行数（見出し行を含む）', '3');
    const cols = field('列数', '3');
    onEnter = () => finish({ rows: clampCount(rows.input.value, 50), cols: clampCount(cols.input.value, 20) });
    root.append(el('div', { className: 'title', textContent: '表のサイズを指定してください' }), rows.caption, rows.input, cols.caption, cols.input,
      buttonRow([{ label: 'キャンセル', run: () => finish(null) }, { label: '挿入', run: () => onEnter(), isDefault: true }]));
    firstInput = rows.input;
  } else if ('link' === kind) {
    // リンク：前後の空白は取り除く
    document.title = 'リンク';
    const url = field('URL', data.url || '');
    onEnter = () => finish({ url: url.input.value.trim() });
    root.append(el('div', { className: 'title', textContent: 'リンク先のURLを入力してください' }), url.caption, url.input,
      buttonRow([{ label: 'キャンセル', run: () => finish(null) }, { label: 'OK', run: () => onEnter(), isDefault: true }]));
    firstInput = url.input;
  } else if ('pdfMargin' === kind) {
    // PDF の余白（px。1px = 1/96 インチ）
    document.title = 'PDFの余白を設定';
    const defaults = data.defaults || { top: 64, bottom: 64, left: 80, right: 80 };
    const values = data.values || defaults;
    const fields = {
      top: field('上の余白', String(Math.round(values.top))),
      bottom: field('下の余白', String(Math.round(values.bottom))),
      left: field('左の余白', String(Math.round(values.left))),
      right: field('右の余白', String(Math.round(values.right))),
    };
    onEnter = () => finish(Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, parseMargin(f.input.value, defaults[k])])));
    root.append(el('div', { className: 'title', textContent: 'PDFに書き出す際の、上下左右の余白（px）を設定してください' }));
    for (const f of Object.values(fields)) root.append(f.caption, f.input);
    root.append(buttonRow([
      { label: '既定値に戻す', className: 'wide', run: () => { for (const [k, f] of Object.entries(fields)) f.input.value = String(defaults[k]); } },
      { label: 'キャンセル', run: () => finish(null) },
      { label: 'OK', run: () => onEnter(), isDefault: true },
    ]));
    firstInput = fields.top.input;
  } else if ('about' === kind) {
    // バージョン情報：Esc・Enter で閉じる
    document.title = data.title || 'mdee';
    root.className = 'about';
    root.append(
      el('img', { src: '../images/mde.png', alt: '' }),
      el('div', { className: 'app', textContent: data.title || 'mdee' }),
      el('div', { className: 'version', textContent: `Version ${data.version || ''}` }),
      el('div', { className: 'copyright', textContent: data.copyright || '' }),
    );
    onEnter = () => finish(null);
  } else if ('find' === kind) {
    buildFind();
  }

  // キー：Enter で OK、Esc でキャンセル（検索と置換は閉じる）、F1 で Readme
  window.addEventListener('keydown', (e) => {
    if ('F1' === e.key) {
      e.preventDefault();
      host?.readme();
    } else if ('Escape' === e.key) {
      e.preventDefault();
      if ('find' === kind) host?.findCommand({ action: 'close' });
      else finish(null);
    } else if ('Enter' === e.key && onEnter && !(e.target instanceof HTMLButtonElement) && !e.isComposing) {
      e.preventDefault();
      onEnter();
    }
  });

  // 準備ができたら、中身の高さを知らせて表示してもらい、最初の入力欄を選択した状態にする
  requestAnimationFrame(() => {
    host?.ready(document.documentElement.scrollHeight);
    if (firstInput) {
      firstInput.focus();
      firstInput.select();
    }
  });

  /** 検索と置換のウィンドウを作る（mdew の FindReplaceWindow と同じ項目）。 */
  function buildFind() {
    document.title = '検索と置換';
    document.body.classList.add('find');
    const searchBox = el('input', { type: 'text', className: 'mono' });
    const replaceBox = el('input', { type: 'text', className: 'mono' });
    const replaceExpander = el('details', {}, [el('summary', { textContent: '置換後の文字列' }), replaceBox]);
    const scopeFile = el('input', { type: 'radio', name: 'scope', checked: true });
    const scopeFolder = el('input', { type: 'radio', name: 'scope' });
    const scopeFolderLabel = el('label', { className: 'option' }, [scopeFolder, 'フォルダ全体（サブフォルダ含む）']);
    const matchCase = el('input', { type: 'checkbox' });
    const useRegex = el('input', { type: 'checkbox' });
    const status = el('div', { id: 'status' });
    const results = el('div', { id: 'results', className: 'hidden', tabIndex: 0 });
    const stepFile = el('div', { id: 'step-file' });
    const stepContext = el('div', { id: 'step-context' });
    const step = el('div', { id: 'step', className: 'hidden' }, [stepFile, stepContext]);

    /** 入力された内容と一緒に、命令を送る。 */
    const send = (a_action, a_index = -1) => host?.findCommand({
      action: a_action, index: a_index, query: searchBox.value, replacement: replaceBox.value,
      folder: scopeFolder.checked, matchCase: matchCase.checked, regex: useRegex.checked,
    });

    /** ウィンドウの高さを中身に合わせる（利用者が大きさを変えた後は、結果の一覧を伸び縮みさせる）。 */
    let sizing = false;
    const fitHeight = () => {
      document.body.classList.remove('manual-size');
      sizing = true;
      requestAnimationFrame(() => {
        const main = document.getElementById('root');
        const saved = main.style.height;
        main.style.height = 'auto';
        const height = main.scrollHeight;
        main.style.height = saved;
        host?.findResize(height);
        setTimeout(() => { sizing = false; }, 300);
      });
    };
    window.addEventListener('resize', () => {
      if (!sizing) document.body.classList.add('manual-size');
    });

    const button = (a_label, a_action, a_options = {}) => {
      const b = el('button', { type: 'button', textContent: a_label, className: a_options.className || '' });
      b.addEventListener('click', () => {
        if (a_options.before) a_options.before();
        send(a_action);
      });
      return b;
    };
    const stepButton = button('1件ずつ置換…', 'stepStart', { className: 'hidden' });
    const replaceAllButton = button('すべて置換', 'replaceAll', { className: 'hidden' });
    const findAllButton = button('すべて検索', 'all', { className: 'default', before: fitHeight });
    replaceExpander.addEventListener('toggle', () => {
      stepButton.classList.toggle('hidden', !replaceExpander.open);
      replaceAllButton.classList.toggle('hidden', !replaceExpander.open);
      fitHeight();
    });
    const stepButtons = el('div', { className: 'wrap-buttons' }, [
      button('置換', 'stepDo'), button('スキップ', 'stepSkip'), button('残りをすべて置換', 'stepRest'), button('終了', 'stepEnd'),
    ]);
    step.append(stepButtons);

    root.append(
      el('div', { className: 'label', textContent: '検索する文字列' }), searchBox, replaceExpander,
      el('div', { className: 'label', textContent: '対象範囲' }),
      el('div', { className: 'row' }, [el('label', { className: 'option' }, [scopeFile, '現在のファイル']), scopeFolderLabel]),
      el('div', { className: 'row', style: 'margin-bottom:16px' }, [
        el('label', { className: 'option' }, [matchCase, '大文字・小文字を区別する']),
        el('label', { className: 'option' }, [useRegex, '正規表現を使用する']),
      ]),
      el('div', { className: 'wrap-buttons' }, [
        button('前を検索', 'prev'), button('次を検索', 'next'), findAllButton, stepButton, replaceAllButton,
      ]),
      status, results, step,
    );
    firstInput = searchBox;
    // Enter：すべて検索（mdew と同じく既定のボタン）
    onEnter = () => findAllButton.click();

    // 結果の一覧：クリックで選び、ダブルクリック・Enter でその箇所へ移る
    let selected = -1;
    const select = (a_index) => {
      selected = a_index;
      [...results.children].forEach((c, i) => c.classList.toggle('selected', i === a_index));
      results.children[a_index]?.scrollIntoView({ block: 'nearest' });
    };
    results.addEventListener('click', (e) => {
      const index = [...results.children].indexOf(e.target.closest('#results > div'));
      if (index >= 0) select(index);
    });
    results.addEventListener('dblclick', (e) => {
      const index = [...results.children].indexOf(e.target.closest('#results > div'));
      if (index >= 0) send('openResult', index);
    });
    results.addEventListener('keydown', (e) => {
      if ('ArrowDown' === e.key || 'ArrowUp' === e.key) {
        e.preventDefault();
        select(Math.max(0, Math.min(results.children.length - 1, selected + ('ArrowDown' === e.key ? 1 : -1))));
      } else if ('Enter' === e.key && selected >= 0) {
        e.preventDefault();
        e.stopPropagation();
        send('openResult', selected);
      }
    });

    host?.onFindShow((a_args) => {
      const text = a_args?.selectedText || '';
      if (text) searchBox.value = useRegex.checked ? text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : text;
      searchBox.focus();
      searchBox.select();
    });
    host?.onFindFolder((a_available) => {
      scopeFolder.disabled = !a_available;
      scopeFolderLabel.classList.toggle('disabled', !a_available);
      if (!a_available) scopeFile.checked = true;
    });
    host?.onFindUpdate((a_update) => {
      if (!a_update) return;
      if ('status' in a_update) status.textContent = a_update.status || '';
      if ('results' in a_update) {
        results.replaceChildren();
        selected = -1;
        if (Array.isArray(a_update.results)) {
          for (const text of a_update.results) results.append(el('div', { textContent: String(text) }));
          results.classList.remove('hidden');
        } else {
          results.classList.add('hidden');
        }
      }
      if ('selectedIndex' in a_update && Number.isInteger(a_update.selectedIndex)) {
        select(a_update.selectedIndex < results.children.length ? a_update.selectedIndex : -1);
      }
      if ('step' in a_update) {
        if (a_update.step && 'object' === typeof a_update.step) {
          stepFile.textContent = a_update.step.file || '';
          stepContext.textContent = a_update.step.context || '';
          step.classList.remove('hidden');
        } else {
          step.classList.add('hidden');
        }
      }
      if (('results' in a_update || 'step' in a_update) && !document.body.classList.contains('manual-size')) fitHeight();
    });
  }
})();
