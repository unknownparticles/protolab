/** 设备外框仅包围画布，不改变组件坐标或实际画布尺寸。 */
export const FRAME_STYLES = Object.freeze({
  phone: { modern: '全面屏手机', classic: '经典手机' },
  tablet: { modern: '窄边框平板', classic: '经典平板' },
  pc: { monitor: '桌面显示器', laptop: '笔记本电脑', browser: '浏览器窗口' },
});
export const CAMERA_STYLES = Object.freeze({ none: '无屏内摄像头', notch: '刘海', island: '灵动岛', 'punch-center': '居中打孔', 'punch-left': '左侧打孔' });
const bounded = (value, fallback, max) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(max, Math.round(Number(value)))) : fallback;
export function systemBarInsets(frame, canvas) {
  const mobile = frame && frame.device !== 'pc';
  const camera = mobile && canvas ? cameraLayout(canvas, frame) : null;
  return { top: mobile && frame.statusBar ? camera?.statusHeight || 28 : 0,
    bottom: mobile && frame.navigation === 'buttons' ? 40 : mobile && frame.navigation === 'gesture' ? 28 : 0 };
}
export function normalizeFrame(raw = {}, preset = 'phone', sanitize = value => value) {
  if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) throw new Error('设备外框格式不正确');
  raw ??= {};
  const device = FRAME_STYLES[preset] ? preset : FRAME_STYLES[raw.device] ? raw.device : 'phone';
  const style = ['none', 'custom'].includes(raw.style) || Object.hasOwn(FRAME_STYLES[device], raw.style) ? raw.style : Object.keys(FRAME_STYLES[device])[0];
  if (raw.html != null && (typeof raw.html !== 'string' || raw.html.length > 100_000)) throw new Error('外框 HTML 不能超过 100000 字符');
  const html = sanitize(raw.html || '', 'html');
  return {
    device, style, camera: Object.hasOwn(CAMERA_STYLES, raw.camera) ? raw.camera : 'none', statusBar: raw.statusBar === true,
    navigation: ['gesture', 'buttons'].includes(raw.navigation) ? raw.navigation : 'none',
    time: /^\d{1,2}:\d{2}$/.test(raw.time || '') && Number(raw.time.split(':')[0]) < 24 && Number(raw.time.split(':')[1]) < 60 ? raw.time : '9:41',
    battery: bounded(raw.battery ?? 100, 100, 100), html,
    insets: Object.fromEntries(['top', 'right', 'bottom', 'left'].map(key => [key, bounded(raw.insets?.[key] ?? 24, 24, 200)])),
  };
}
/** 屏内摄像头遮挡实际画布；横屏随设备旋转到左侧。 */
export function cameraLayout(canvas, frame) {
  if (frame.device !== 'phone' || frame.style === 'classic' || frame.camera === 'none') return null;
  const landscape = canvas.width > canvas.height;
  const edge = landscape ? canvas.height : canvas.width;
  const kind = frame.camera;
  const long = Math.min(kind === 'notch' ? 120 : kind === 'island' ? 96 : 14, edge * .4);
  const short = kind === 'notch' ? 28 : kind === 'island' ? 26 : 14;
  const offset = kind === 'notch' ? 0 : kind === 'island' ? 8 : 12;
  const along = kind === 'punch-left' ? Math.min(24, edge - long) : (edge - long) / 2;
  return { kind, landscape, width: landscape ? short : long, height: landscape ? long : short,
    left: landscape ? offset : along, top: landscape ? along : offset,
    statusHeight: landscape ? 28 : ['notch', 'island'].includes(kind) ? 44 : 36,
    statusPaddingLeft: !landscape && kind === 'punch-left' ? 50 : 16 };
}
export function frameLayout(canvas, frame) {
  const key = `${frame.device}-${frame.style}`;
  const sizes = {
    'phone-modern': [12, 12, 12, 12], 'phone-classic': [56, 14, 56, 14],
    'tablet-modern': [20, 20, 20, 20], 'tablet-classic': [52, 24, 52, 24],
    'pc-monitor': [24, 24, 110, 24], 'pc-laptop': [24, 24, 52, 24], 'pc-browser': [40, 1, 1, 1],
  };
  const [top, right, bottom, left] = frame.style === 'custom' ? ['top', 'right', 'bottom', 'left'].map(side => frame.insets[side]) : sizes[key] || [0, 0, 0, 0];
  return { top, right, bottom, left, width: canvas.width + left + right, height: canvas.height + top + bottom };
}
export const CUSTOM_FRAME_HTML = '<div style="width:100%;height:100%;background:#17324d;border:3px solid #6aa9d8;border-radius:32px;box-sizing:border-box"></div>';
