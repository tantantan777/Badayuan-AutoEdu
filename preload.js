const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 已有API
  userInput: (data) => ipcRenderer.invoke('user-input', data),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getConfig: () => ipcRenderer.invoke('get-config'),
  startPlaywright: (config) => ipcRenderer.invoke('start-playwright', config),
  // 窗口控制
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  restoreWindow: () => ipcRenderer.send('restore-window'),
  // 课程刷新
  refreshCourseList: () => ipcRenderer.invoke('refresh-course-list')
}); 