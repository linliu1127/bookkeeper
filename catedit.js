/* 類別編輯器：新增／刪除／改名類別與子類別。資料規則全在 categories.js，這裡只管畫面。 */
var CatEditor = (function () {
  'use strict';

  var tab = 'expense';
  var openCat = null; // 目前展開的類別名稱（只存在記憶體）

  function BK() { return window.BK; }
  function $(s) { return document.querySelector(s); }

  async function apply(result, entriesChanged) {
    if (!result.ok) { BK().toast(result.error); return false; }
    // 改名後復原／重做紀錄裡可能還有舊名稱的快照（即使目前沒有帳目用到），一律清空
    await BK().catsChanged({ entriesChanged: !!entriesChanged });
    render();
    return true;
  }

  function btn(text, cls, onClick, label) {
    var b = BK().h('button', { type: 'button', class: cls, text: text });
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', function (ev) { ev.stopPropagation(); onClick(); });
    return b;
  }

  function addRow(placeholder, withIcon, onAdd) {
    var h = BK().h;
    var name = h('input', { type: 'text', placeholder: placeholder, maxlength: '20', autocomplete: 'off' });
    var icon = withIcon ? h('input', { type: 'text', class: 'ce-icon', placeholder: '🏷️', maxlength: '4', 'aria-label': '圖示（emoji）', autocomplete: 'off' }) : null;
    var go = btn('新增', 'btn primary ce-add', function () {
      Promise.resolve(onAdd(name.value, icon ? icon.value : '')).then(function (ok) { if (ok) { name.value = ''; if (icon) icon.value = ''; } });
    });
    name.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') go.click(); });
    return h('div', { class: 'ce-addrow' }, icon, name, go);
  }

  function render() {
    var h = BK().h;
    var data = BK().catData();
    var body = $('#ce-body');
    body.textContent = '';
    Array.prototype.forEach.call(document.querySelectorAll('#ce-tabs button'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
    });

    var list = h('div', { class: 'ce-list' });
    if (!data[tab].length) list.appendChild(h('p', { class: 'ce-empty', text: '還沒有任何類別，請在下方新增。' }));
    data[tab].forEach(function (c) {
      var isOpen = openCat === c.name;
      var head = h('div', { class: 'ce-head', role: 'button', tabindex: '0', 'aria-expanded': String(isOpen) },
        h('span', { class: 'ce-ico', text: c.icon }),
        h('span', { class: 'ce-name', text: c.name }),
        h('span', { class: 'ce-count', text: c.subs.length ? c.subs.length + ' 個子類別' : '' }),
        btn('改名', 'ce-btn', function () {
          if (tab === 'income' && (c.name === InvestCore.CATEGORY || (c.name === BondCore.CATEGORY && BK().bonds().funds.length))) {
            BK().toast('「' + c.name + '」與投資理財連動，不能改名');
            return;
          }
          var n = prompt('類別新名稱', c.name);
          if (n === null) return;
          var wasOpen = openCat === c.name;
          var r = Categories.rename(data, BK().entries, tab, c.name, n);
          if (r.ok && wasOpen) openCat = String(n).trim();
          if (r.ok && tab === 'expense' && BudgetCore.renameCat(BK().budgets(), c.name, String(n).trim())) BK().saveBudgets();
          apply(r, true);
        }, '改名：' + c.name),
        btn('刪除', 'ce-btn danger', function () {
          if (!confirm('刪除類別「' + c.name + '」？既有帳目不受影響。')) return;
          Categories.remove(data, tab, c.name);
          if (openCat === c.name) openCat = null;
          apply({ ok: true });
        }, '刪除：' + c.name));
      function toggle() { openCat = isOpen ? null : c.name; render(); }
      head.addEventListener('click', toggle);
      head.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
      var item = h('div', { class: 'ce-item' }, head);

      if (isOpen) {
        var subs = h('div', { class: 'ce-subs' });
        c.subs.forEach(function (s) {
          if (BK().isManagedSub(tab, c.name, s)) {
            // 由投資理財自動產生（定存：完結後移除；債券：刪除 ETF 後移除），要改請到投資區
            subs.appendChild(h('div', { class: 'ce-sub' },
              h('span', { class: 'ce-name', text: s }),
              h('span', { class: 'ce-count', text: c.name === BondCore.CATEGORY ? '債券・自動' : '定存・自動' })));
            return;
          }
          subs.appendChild(h('div', { class: 'ce-sub' },
            h('span', { class: 'ce-name', text: s }),
            btn('改名', 'ce-btn', function () {
              var n = prompt('子類別新名稱', s);
              if (n === null) return;
              apply(Categories.renameSub(data, BK().entries, tab, c.name, s, n), true);
            }, '改名：' + s),
            btn('刪除', 'ce-btn danger', function () {
              if (!confirm('刪除子類別「' + s + '」？既有帳目不受影響。')) return;
              Categories.removeSub(data, tab, c.name, s);
              apply({ ok: true });
            }, '刪除：' + s)));
        });
        subs.appendChild(addRow('新增「' + c.name + '」的子類別', false, function (name) {
          return apply(Categories.addSub(data, tab, c.name, name));
        }));
        item.appendChild(subs);
      }
      list.appendChild(item);
    });
    body.appendChild(list);

    body.appendChild(h('h3', { class: 'ce-title', text: '新增類別' }));
    body.appendChild(addRow('類別名稱', true, function (name, icon) {
      return apply(Categories.add(data, tab, name, icon));
    }));
  }

  function open() {
    BK().openOverlay($('#catedit'));
    render();
  }

  function init() {
    $('#ce-tabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b || b.dataset.tab === tab) return;
      tab = b.dataset.tab;
      openCat = null;
      render();
    });
    $('#ce-close').addEventListener('click', function () { BK().closeOverlay(); });
  }

  return { open: open, init: init };
})();
