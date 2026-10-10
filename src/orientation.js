export const ORIENTATION_ACTIONS = Object.freeze({
  none: '保持原样', rotate90: '顺时针旋转 90°', rotate180: '旋转 180°', rotate270: '逆时针旋转 90°', hide: '隐藏',
});

/** 响应只改变展示，坐标和尺寸始终属于原始设计。 */
export function normalizeOrientationResponse(raw) {
  if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) throw new Error('屏幕方向响应格式不正确');
  const action = value => {
    if (value == null) return 'none';
    if (typeof value !== 'string' || !Object.hasOwn(ORIENTATION_ACTIONS, value)) throw new Error('不支持的屏幕方向响应');
    return value;
  };
  return { enabled: raw?.enabled === true, portrait: action(raw?.portrait), landscape: action(raw?.landscape) };
}

export function orientationPresentation(item, canvas) {
  const response = normalizeOrientationResponse(item.orientationResponse);
  const action = response.enabled && canvas ? response[canvas.width > canvas.height ? 'landscape' : 'portrait'] : 'none';
  return { hidden: action === 'hide', angle: { rotate90: 90, rotate180: 180, rotate270: -90 }[action] || 0 };
}
