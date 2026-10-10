export const LIBRARY_KEY = 'protolab.library.v1';
export const PROJECT_KEY = 'protolab.project.v1';
export function readStorage(key, validate) {
  const value = localStorage.getItem(key);
  return value === null ? null : validate(JSON.parse(value));
}
export function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
export function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function readFile(file, mode = 'text') {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('文件读取失败，请重新选择'));
    if (mode === 'dataURL') reader.readAsDataURL(file); else reader.readAsText(file);
  });
}
