import { placementBounds } from './safe-area.js';
import { visibilityLayout } from './visibility.js';

export function normalizeReferenceSpec(raw = {}, mode = 'page') {
  const spec = {};
  for (const [key, max] of [['name', 40], ['color', 100], ['function', 1000]]) {
    const value = String(raw[key] || '').trim();
    if (value.length > max) throw new Error('基础参考信息过长');
    if (value) spec[key] = value;
  }
  for (const [key, min, max, fallback] of [
    ['width', mode === 'component' ? 1 : 100, 2000], ['height', mode === 'component' ? 1 : 100, 2000],
    ['bodyFont', 8, 100, 16], ['titleFont', 8, 150, 24], ['smallFont', 8, 100, 12], ['gap', 0, 200, 16],
  ]) {
    const value = raw[key] == null || raw[key] === '' ? fallback : Number(raw[key]);
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < min || value > max) throw new Error('参考尺寸、字号或间距超出允许范围');
    spec[key] = value;
  }
  return spec;
}

const inline = (content, key) => content.match(new RegExp(`(?:^|[;"'\\s])${key}\\s*:\\s*([^;"'<>]+)`, 'i'))?.[1]?.trim();
export function layoutReference(project, raw = {}, mode = 'page') {
  const spec = normalizeReferenceSpec(raw, mode);
  const canvas = { ...project.canvas, width: spec.width || project.canvas.width, height: spec.height || project.canvas.height };
  const bounds = placementBounds({ ...project, canvas });
  return {
    typography: { body: spec.bodyFont, title: spec.titleFont, small: spec.smallFont,
      titleRatio: Number((spec.titleFont / spec.bodyFont).toFixed(2)), smallRatio: Number((spec.smallFont / spec.bodyFont).toFixed(2)) },
    layout: { width: canvas.width, height: canvas.height, bounds, gap: spec.gap,
      safeArea: project.safeArea, frame: project.frame, maxItems: 200, maxSize: 2000,
      rule: '坐标和宽高使用实际像素；组件必须放在可排版区域内，文字完整可读，避免非设计所需的重叠和裁切。' },
    components: visibilityLayout(project.items).map(item => {
      const font = item.appearance?.fontSize ?? Number(inline(item.content, 'font-size')?.match(/^([\d.]+)px$/)?.[1]);
      return { id: item.id, name: item.name, type: item.type, x: item.x, y: item.y, width: item.width, height: item.height,
        fontSize: font > 0 ? font : null, fontRatio: font > 0 ? Number((font / spec.bodyFont).toFixed(2)) : null,
        color: item.appearance?.textColor || item.appearance?.color || inline(item.content, 'color') || '',
        function: item.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100),
      };
    }),
  };
}
