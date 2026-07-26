const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // ===== АКТИВАЦИЯ =====
    closeWindow: () => ipcRenderer.send('close-window'),
    checkLicense: () => ipcRenderer.send('check-license'),
    activateLicense: (key) => ipcRenderer.send('activate-license', key),
    
    onLicenseStatus: (callback) => {
        ipcRenderer.on('license-status', (event, status) => callback(status));
    },
    onActivationResult: (callback) => {
        ipcRenderer.on('activation-result', (event, result) => callback(result));
    },
    onLicenseReady: (callback) => {
        ipcRenderer.on('license-ready', (event, data) => callback(data));
    },

    // ===== ОБНОВЛЕНИЯ =====
    checkUpdates: () => ipcRenderer.send('check-updates'),
    getVersion: () => {
        return new Promise((resolve) => {
            ipcRenderer.once('version-info', (event, version) => resolve(version));
            ipcRenderer.send('get-version');
        });
    },
    onUpdateResult: (callback) => {
        ipcRenderer.on('update-result', (event, result) => callback(result));
    },
    
    // ===== НОВЫЕ ФУНКЦИИ ДЛЯ ОБНОВЛЕНИЙ =====
    onUpdateProgress: (callback) => {
        ipcRenderer.on('update-progress', (event, progress) => callback(progress));
    },
    onUpdateStatus: (callback) => {
        ipcRenderer.on('update-status', (event, status) => callback(status));
    }
});