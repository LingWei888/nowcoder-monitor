const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  onNewScreenshot: (callback) => ipcRenderer.on('new-screenshot', (_event, data) => callback(data)),
  getConfig: () => ipcRenderer.invoke('get-config'),
  openClientDetail: (clientId) => ipcRenderer.invoke('open-client-detail', clientId),
  onClientsUpdated: (callback) => ipcRenderer.on('clients-updated', () => callback()),
  getTunnelStatus: () => ipcRenderer.invoke('get-tunnel-status'),
  onTunnelStarted: (callback) => ipcRenderer.on('tunnel-started', (_event, data) => callback(data))
});
