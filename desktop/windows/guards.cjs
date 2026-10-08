function canOpenGithub(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.port && !url.username && !url.password
      && (url.pathname === '/Chin-Jing1998/context-lens' || url.pathname.startsWith('/Chin-Jing1998/context-lens/'));
  } catch { return false; }
}
function fit(frame, area) {
  const width = Math.min(frame.width, area.width), height = Math.min(frame.height, area.height);
  return { width, height, x: Math.round(Math.max(area.x, Math.min(frame.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(frame.y, area.y + area.height - height))) };
}
module.exports = { canOpenGithub, fit };
