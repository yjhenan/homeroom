/**
 * 打印：把目标元素克隆到打印宿主，配 @media print 样式走系统对话框
 *
 * WebView2 的打印预览是异步渲染的——不能用固定 setTimeout 清理（预览还没快照内容就被删了），
 * 必须等 afterprint 事件（打印对话框真正关闭）再清理
 */

/** 打印一个 DOM 元素（含标题） */
export function printElement(el: HTMLElement | null | undefined, title: string) {
  if (!el) return;
  cleanupPrintHost();
  const div = document.createElement('div');
  div.id = '__print_host__';
  div.innerHTML = `<h1 class="print-title">${escapeHtml(title)}</h1>${el.outerHTML}`;
  document.body.appendChild(div);
  document.body.classList.add('printing');

  const cleanup = () => {
    document.body.classList.remove('printing');
    div.remove();
  };

  // afterprint 在打印对话框真正关闭后触发（含取消）
  window.addEventListener('afterprint', cleanup, { once: true });
  // 兜底：极端情况下 afterprint 不触发（某些 WebView 版本），60s 后强制清理防泄漏
  window.setTimeout(() => {
    if (document.getElementById('__print_host__')) {
      window.removeEventListener('afterprint', cleanup);
      cleanup();
    }
  }, 60_000);

  window.print();
}

/** 学生页点名表等自行拼 HTML 的场景：只做宿主管理 */
export function cleanupPrintHost() {
  const prev = document.getElementById('__print_host__');
  if (prev) prev.remove();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);
}
