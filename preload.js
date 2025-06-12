const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ...已有API...
  minimizeWindow: () => ipcRenderer.invoke('minimizeWindow'),
  restoreWindow: () => ipcRenderer.invoke('restoreWindow'),
}); 