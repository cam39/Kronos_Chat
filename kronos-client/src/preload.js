const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  navigateTo: (url) => ipcRenderer.send('navigate-to', url),
  setFullscreen: (fullscreen) => ipcRenderer.send('set-fullscreen', fullscreen),
  getWindowSize: () => ipcRenderer.invoke('get-window-size')
});
