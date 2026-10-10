export const IMAGE_FITS = Object.freeze({ fill: '拉伸填充', cover: '裁剪填充', contain: '完整显示', none: '原始大小', 'scale-down': '仅缩小' });
export const BLEND_MODES = Object.freeze({ normal: '正常', multiply: '正片叠底', screen: '滤色', overlay: '叠加', darken: '变暗', lighten: '变亮', 'color-dodge': '颜色减淡', 'color-burn': '颜色加深', 'hard-light': '强光', 'soft-light': '柔光', difference: '差值', exclusion: '排除', hue: '色相', saturation: '饱和度', color: '颜色', luminosity: '明度' });

/** 只保留明确设置的覆盖值；旧组件继续使用自身样式。 */
export function normalizeAppearance(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('组件样式格式不正确');
  const result = {};
  for (const key of ['background', 'color', 'textColor']) {
    if (raw[key] == null || raw[key] === '') continue;
    const value = String(raw[key]).trim();
    if (!/^(?:#[\da-f]{3}|#[\da-f]{4}|#[\da-f]{6}|#[\da-f]{8}|transparent)$/i.test(value)) throw new Error('颜色请输入十六进制色值或 transparent');
    result[key] = value;
  }
  if (raw.fontFamily != null && raw.fontFamily !== '') {
    const value = String(raw.fontFamily).trim();
    if (!value || value.length > 200 || !/^[\p{L}\p{N}\s,\-"']+$/u.test(value)) throw new Error('字体名称格式不正确');
    result.fontFamily = value;
  }
  for (const [key, min, max] of [['fontSize', 1, 300], ['fontWeight', 100, 900], ['opacity', 0, 100]]) {
    if (raw[key] == null || raw[key] === '') continue;
    const value = Number(raw[key]);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error('字号、字重或不透明度超出可用范围');
    result[key] = value;
  }
  for (const [key, choices] of [['imageFit', IMAGE_FITS], ['blendMode', BLEND_MODES]]) {
    if (raw[key] == null || raw[key] === '') continue;
    if (!Object.hasOwn(choices, raw[key])) throw new Error('图片填充或混合模式不正确');
    result[key] = raw[key];
  }
  return result;
}

export function spacingSides(value = '0') {
  const [top, right = top, bottom = top, left = right] = String(value).trim().split(/\s+/).map(parseFloat);
  return { top, right, bottom, left };
}

export function appearancePresentation(raw) {
  const appearance = normalizeAppearance(raw);
  const classes = [], styles = [];
  for (const [key, value] of Object.entries(appearance)) {
    if (key === 'opacity') styles.push(`opacity:${value / 100}`);
    else if (key === 'blendMode') styles.push(`mix-blend-mode:${value}`);
    else {
      const cssKey = key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
      classes.push(`styled-${cssKey}`);
      styles.push(`--item-${cssKey}:${value}${key === 'fontSize' ? 'px' : ''}`);
      if (key === 'background') styles.push(`background:${value}`);
    }
  }
  return { classes: classes.join(' '), style: styles.join(';') };
}

export const APPEARANCE_CSS = `
.styled-background>.prototype-content>:not(svg):not(img){background:var(--item-background)!important}
.styled-color svg :is(path,rect,circle,ellipse,polygon,polyline):not([fill="none"]):not([stroke]){fill:var(--item-color)!important}
.styled-color svg[fill]:not([fill="none"]),.styled-color svg [fill]:not([fill="none"]){fill:var(--item-color)!important}
.styled-color svg[stroke]:not([stroke="none"]),.styled-color svg [stroke]:not([stroke="none"]){stroke:var(--item-color)!important}
.styled-color>.prototype-content{color:var(--item-color)}
.styled-text-color>.prototype-content,.styled-text-color>.prototype-content *{color:var(--item-text-color)!important}
.styled-text-color svg :is(text,tspan){fill:var(--item-text-color)!important}
.styled-font-family>.prototype-content,.styled-font-family>.prototype-content *{font-family:var(--item-font-family)!important}
.styled-font-size>.prototype-content,.styled-font-size>.prototype-content *{font-size:var(--item-font-size)!important}
.styled-font-weight>.prototype-content,.styled-font-weight>.prototype-content *{font-weight:var(--item-font-weight)!important}
.styled-image-fit>.prototype-content img{object-fit:var(--item-image-fit)!important;object-position:center!important}
`;
