const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 700,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
};

// App ready
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC pour naviguer vers une URL
ipcMain.on('navigate-to', (event, url) => {
  if (mainWindow) {
    mainWindow.loadURL(url);
  }
});

// IPC pour obtenir la taille de la fenêtre
ipcMain.handle('get-window-size', () => {
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    return { width: bounds.width, height: bounds.height };
  }
  return { width: 600, height: 700 };
});

// IPC pour redimensionner la fenêtre en mode plein écran
ipcMain.on('set-fullscreen', (event, fullscreen) => {
  if (mainWindow) {
    mainWindow.setFullScreen(fullscreen);
  }
});
