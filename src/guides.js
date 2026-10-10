export const GUIDES_KEY = 'protolab.guides.v1';
export function normalizeGuides(raw = {}) {
  return { rulers: raw?.rulers !== false, grid: raw?.grid === true,
    gridSize: [5, 10, 20, 40, 50, 100].includes(raw?.gridSize) ? raw.gridSize : 20 };
}
/** 刻度间距随缩放调整；文字保持屏幕字号，标签使用实际像素。 */
export function rulerMarkup(length, zoom, vertical = false) {
  const major = [10, 20, 50, 100, 200, 500, 1000].find(step => step * zoom >= 50) || 1000;
  const minor = major / 5;
  const extent = length * zoom;
  const ticks = [];
  for (let value = 0; value <= length; value += minor) {
    const position = value * zoom;
    const large = value % major === 0;
    ticks.push(vertical ? `<path d="M${large ? 12 : 17} ${position}H22"/>` : `<path d="M${position} ${large ? 12 : 17}V22"/>`);
    if (large) ticks.push(vertical ? `<text transform="translate(9 ${position + 3}) rotate(-90)" text-anchor="end">${value}</text>` : `<text x="${position + 3}" y="10">${value}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${vertical ? 22 : extent}" height="${vertical ? extent : 22}" aria-hidden="true">${ticks.join('')}</svg>`;
}
