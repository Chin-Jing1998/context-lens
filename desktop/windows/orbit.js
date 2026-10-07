const host = window.contextLensHost;
const svg = document.getElementById('orbit'), ball = document.getElementById('ball');
const titles = { context: '上下文', usage: '用量', cost: '费用', commands: '命令行', skills: '技能', mcp: 'MCP', runtime: '会话' };
const sectors = new Map();
const point = (r, deg) => [138 + r * Math.cos(deg * Math.PI / 180), 138 + r * Math.sin(deg * Math.PI / 180)];
const make = (name, attrs = {}) => { const item = document.createElementNS('http://www.w3.org/2000/svg', name); for (const [key, value] of Object.entries(attrs)) item.setAttribute(key, value); return item; };
Object.entries(titles).forEach(([name, title], index) => {
  const middle = -90 + index * 360 / 7, start = middle - 360 / 14 + 2, end = middle + 360 / 14 - 2;
  const [a, b, c, d] = [point(125, start), point(125, end), point(65, end), point(65, start)];
  const group = make('g', { class: 'orbit-sector', role: 'button', tabindex: '0', 'aria-label': title, 'aria-pressed': 'false' });
  group.append(make('path', { d: `M${a}A125,125 0 0 1 ${b}L${c}A65,65 0 0 0 ${d}Z` }));
  const [x, y] = point(94, middle), label = make('text', { x, y: y - 5 }), value = make('text', { x, y: y + 14, class: 'orbit-value' });
  label.textContent = title; value.textContent = '—'; group.append(label, value); svg.append(group); sectors.set(name, { group, value });
  const activate = () => host.postMessage({ action: 'island', island: name });
  group.onclick = activate; group.onkeydown = event => {
    if (['Enter', ' '].includes(event.key)) { event.preventDefault(); activate(); }
    else if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const all = [...sectors.values()], target = event.key === 'Home' ? 0 : event.key === 'End' ? 6 : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : 6)) % 7; all[target].group.focus();
    }
  };
});
const hub = make('g', { class: 'orbit-hub', role: 'button', tabindex: '0', 'aria-label': '收起环形岛' });
hub.append(make('circle', { cx: 138, cy: 138, r: 29 })); const reading = make('text', { x: 138, y: 139 }); reading.textContent = '—'; hub.append(reading); svg.append(hub);
hub.onclick = () => host.postMessage({ action: 'collapse' }); hub.onkeydown = event => { if (['Enter', ' '].includes(event.key)) hub.onclick(); };
let pressed, dragging = false;
ball.onpointerdown = event => { if (event.button !== 0) return; pressed = { x: event.screenX, y: event.screenY }; dragging = false; ball.setPointerCapture(event.pointerId); host.postMessage({ action: 'drag-start' }); };
ball.onpointermove = event => { if (!pressed) return; const dx = event.screenX - pressed.x, dy = event.screenY - pressed.y; if (Math.hypot(dx, dy) > 4) dragging = true; if (dragging) host.postMessage({ action: 'drag', dx, dy }); };
ball.onpointerup = () => { if (!pressed) return; pressed = null; host.postMessage({ action: dragging ? 'drag-end' : 'toggle-orbit' }); };
ball.onpointercancel = () => { pressed = null; host.postMessage({ action: 'drag-end' }); };
ball.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); host.postMessage({ action: 'toggle-orbit' }); } };
document.addEventListener('keydown', event => { if (event.key === 'Escape') host.postMessage({ action: 'collapse' }); });
host.onEvent((name, detail) => {
  if (name !== 'surface') return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(detail.style || {})) root.dataset[key] = value;
  root.dataset.reduceMotion = String(detail.reduceMotion === true); document.body.dataset.surface = detail.surface;
  const percent = typeof detail.percent === 'number' ? Math.max(0, detail.percent) : null;
  const text = percent === null ? '—' : Math.round(percent) + '%'; reading.textContent = document.getElementById('ball-value').textContent = text;
  const arc = 2 * Math.PI * 23; document.getElementById('ball-progress').style.strokeDasharray = `${percent === null ? 0 : arc * Math.min(100, percent) / 100} ${arc}`;
  for (const [key, item] of sectors) { item.value.textContent = detail.values?.[key] ?? '—'; item.group.setAttribute('aria-pressed', String(detail.island === key)); }
});
host.postMessage({ action: 'surface-ready' });
