const { contextBridge, ipcRenderer } = require('electron');
const send = value => {
  if (!value || typeof value.action !== 'string') return;
  ipcRenderer.send('lens-action', value);
};
contextBridge.exposeInMainWorld('webkit', { messageHandlers: { lens: { postMessage: send } } });
contextBridge.exposeInMainWorld('contextLensHost', {
  postMessage: send,
  onEvent(callback) { ipcRenderer.on('lens-event', (_event, name, detail) => callback(name, detail)); },
});
