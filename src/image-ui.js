export const MAX_REFERENCE_IMAGE = 3 * 1024 * 1024;
export const IMAGE_UI_REQUIREMENT = '根据参考图片还原界面，保留原文案、布局、颜色和图形，拆分为可独立编辑的组件，并为每个组件自动命名。';
export function imageCanvasSize(width, height) {
  if (![width, height].every(value => Number.isFinite(value) && value >= 100)) throw new Error('请选择宽高均至少 100 像素的界面图片');
  const scale = Math.min(1, 2000 / Math.max(width, height));
  const size = { width: Math.round(width * scale), height: Math.round(height * scale) };
  if (Math.min(size.width, size.height) < 100) throw new Error('图片比例过长，请裁剪为单个界面后上传');
  return size;
}
export function validateReferenceImage(image) {
  if (!image || typeof image.dataURL !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataURL)) throw new Error('请选择 PNG、JPEG 或 WebP 界面图片');
  if (image.dataURL.length > Math.ceil(MAX_REFERENCE_IMAGE / 3) * 4 + 64) throw new Error('参考图片不能超过 3 MB');
  const size = imageCanvasSize(image.width, image.height);
  if (size.width !== image.width || size.height !== image.height) throw new Error('参考图片画布尺寸无效');
  return image;
}
export function nameImageComponents(items) {
  const names = new Set();
  return items.map(item => {
    const text = item.content.replace(/<[^>]*>/g, ' ').replace(/&[^;\s]+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
    const kind = /<button\b/i.test(item.content) ? '按钮' : /<(?:input|textarea)\b/i.test(item.content) ? '输入框' : /<img\b/i.test(item.content) ? '图片' : item.type === 'svg' ? '图标' : text ? '文本' : '容器';
    const base = (item.name?.trim() || `${text ? `${text} · ` : ''}${kind}`).slice(0, 70);
    let name = base, number = 2;
    while (names.has(name)) name = `${base} ${number++}`;
    names.add(name);
    return { ...item, name };
  });
}
