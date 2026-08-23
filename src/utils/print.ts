/**
 * 打印：把目标元素克隆到打印容器，配 @media print 样式走系统对话框
 *
 * WebView2（桌面版）与浏览器同走 window.print()，无需区分环境
 */

/** 打印一个 DOM 元素（含标题） */
export function printElement(el: HTMLElement | null | undefined, title: string) {
  if (!el) return;
  const host = document.getElementById('__print_host__');
  if (host) host.remove();

  const div = document.createElement('div');
  div.id = '__print_host__';
  div.innerHTML = `<h1 class="print-title">${escapeHtml(title)}</h1>${el.outerHTML}`;
  document.body.appendChild(div);
  document.body.classList.add('printing');
  window.print();
  // 打印对话框关闭后清理（部分环境是同步返回）
  window.setTimeout(() => {
    document.body.classList.remove('printing');
    div.remove();
  }, 300);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);
}
