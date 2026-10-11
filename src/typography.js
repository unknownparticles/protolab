/** 编辑器、预览和导出共用；原始字号只读取一次，反复缩放不累积误差。 */
export function fitItemText(node, { maxWidth = parseFloat(node.style.width), growWidth = false } = {}) {
  if (!node.dataset.textBasis || !node.isConnected || !node.getClientRects().length) return parseFloat(node.style.width);
  const content = node.querySelector('.prototype-content');
  if (!content) return parseFloat(node.style.width);
  const width = parseFloat(node.style.width), height = parseFloat(node.style.height);
  const basis = JSON.parse(node.dataset.textBasis);
  const fixed = node.classList.contains('styled-font-size');
  if (!node.textMetrics) {
    node.textMetrics = [content, ...content.querySelectorAll('*')].filter(element => !element.closest('svg')).map(element => {
      const style = getComputedStyle(element);
      return { element, font: parseFloat(style.fontSize), line: style.lineHeight === 'normal' ? null : parseFloat(style.lineHeight) };
    });
  }
  const roots = [...content.children], root = roots[0];
  // 单行文案可以拉长；段落、换行和复合布局保留原来的排版宽度。
  const simple = roots.length <= 1 && !content.querySelector('br,textarea,pre,svg,img') &&
    (!root || !root.querySelector('div,p,h1,h2,h3,h4,h5,h6,section,article,input,button,select')) &&
    !content.textContent.includes('\n') && (!root || !['UL', 'OL', 'TABLE'].includes(root.tagName)) &&
    (!root?.style.whiteSpace || root.style.whiteSpace === 'nowrap');
  const apply = scale => {
    if (fixed) return;
    for (const { element, font, line } of node.textMetrics) {
      element.style.setProperty('font-size', `${font * scale}px`, 'important');
      if (line != null) element.style.setProperty('line-height', `${line * scale}px`, 'important');
    }
  };
  const target = fixed ? 1 : Math.max(.01, simple ? height / basis.height : Math.min(width / basis.width, height / basis.height));
  apply(target);
  let measure, measureHost;
  try {
    if (simple) {
      measure = node.cloneNode(true);
      measure.hidden = false; measure.removeAttribute('id');
      Object.assign(measure.style, { position: 'relative', left: '0', top: '0', width: 'max-content', height: 'auto', maxWidth: 'none', visibility: 'hidden', transform: 'none', pointerEvents: 'none' });
      const inner = measure.querySelector('.prototype-content');
      Object.assign(inner.style, { flex: 'none', width: 'max-content', overflow: 'visible' });
      const child = inner.firstElementChild;
      if (child) Object.assign(child.style, { width: 'auto', height: 'auto', minWidth: '0', maxWidth: 'none', whiteSpace: 'nowrap' });
      // 隔离画布外壳的百分比宽高规则，测量组件本身的自然尺寸。
      measureHost = document.createElement('div');
      Object.assign(measureHost.style, { position: 'fixed', left: '-10000px', top: '0', visibility: 'hidden', pointerEvents: 'none' });
      node.parentElement.append(measureHost); measureHost.append(measure);
      const natural = () => {
        // 输入框的原生固有宽度不由文案决定，使用当前字体测量提示和内容。
        if (child?.tagName === 'INPUT') {
          const style = getComputedStyle(child), canvas = document.createElement('canvas'), context = canvas.getContext('2d');
          context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const textWidth = Math.max(...[child.value, child.placeholder].map(text => context.measureText(text).width));
          const extra = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, key) => sum + (parseFloat(style[key]) || 0), 0);
          child.style.width = `${Math.ceil(textWidth + extra + 2)}px`;
        }
        return { width: measure.offsetWidth, height: measure.offsetHeight };
      };
      const preferred = natural();
      const nextWidth = growWidth ? Math.min(Math.max(1, maxWidth), Math.max(width, Math.ceil(preferred.width))) : width;
      node.style.width = `${nextWidth}px`;
      const measureMetrics = [inner, ...inner.querySelectorAll('*')];
      const fits = scale => {
        apply(scale);
        node.textMetrics.forEach(({ font, line }, index) => {
          const element = measureMetrics[index];
          element.style.setProperty('font-size', `${font * scale}px`, 'important');
          if (line != null) element.style.setProperty('line-height', `${line * scale}px`, 'important');
        });
        const size = natural();
        return size.width <= nextWidth && size.height <= height;
      };
      if (!fixed && !fits(target)) {
        let low = 0, high = target;
        for (let index = 0; index < 12; index++) {
          const mid = (low + high) / 2;
          if (fits(mid)) low = mid; else high = mid;
        }
        apply(Math.max(.01, low));
      }
      if (root && !fixed) root.style.whiteSpace = 'nowrap';
      return nextWidth;
    }
    // 复合组件保持字号层级，空间不够时共同缩小。
    const fits = scale => {
      apply(scale);
      return [content, ...content.querySelectorAll('*')].filter(element => !element.closest('svg') && element.clientWidth && element.clientHeight)
        .every(element => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1);
    };
    if (!fixed && !fits(target)) {
      let low = 0, high = target;
      for (let index = 0; index < 12; index++) {
        const mid = (low + high) / 2;
        if (fits(mid)) low = mid; else high = mid;
      }
      apply(Math.max(.01, low));
    }
    return width;
  } finally { measureHost?.remove(); }
}
