const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  onNewScreenshot: (callback) => ipcRenderer.on('new-screenshot', (_event, data) => callback(data))
});
