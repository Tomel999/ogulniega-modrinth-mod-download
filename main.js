const { app, BrowserWindow, ipcMain, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { pipeline } = require('stream/promises');

let fetch;
import('node-fetch').then(nodeFetch => {
  fetch = nodeFetch.default;
}).catch(err => console.error('Failed to load node-fetch:', err));


function createWindow () {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});


ipcMain.handle('get-profile-folders', async () => {
    let baseOgulniegaProfileModsPath = "";
    const profiles = {
        baseProfilePath: null,
        profileFolders: []
    };

    if (os.platform() === 'win32' && process.env.APPDATA) {
        baseOgulniegaProfileModsPath = path.join(process.env.APPDATA, '.ogulniega', 'profile', 'mods');
    } else if (os.platform() === 'darwin') {
        baseOgulniegaProfileModsPath = path.join(os.homedir(), '.ogulniega', 'profile', 'mods');
    } else {
        baseOgulniegaProfileModsPath = path.join(os.homedir(), '.ogulniega', 'profile', 'mods');
    }

    console.log(`[MainJS] Docelowa bazowa ścieżka profili (python-like): ${baseOgulniegaProfileModsPath}`);

    try {
        const stats = await fs.stat(baseOgulniegaProfileModsPath);
        if (stats.isDirectory()) {
            profiles.baseProfilePath = baseOgulniegaProfileModsPath;
            console.log(`[MainJS] Znaleziono bazowy folder (python-like): ${baseOgulniegaProfileModsPath}`);

            const items = await fs.readdir(baseOgulniegaProfileModsPath);
            for (const itemName of items) {
                const itemFullPath = path.join(baseOgulniegaProfileModsPath, itemName);
                try {
                    const itemStat = await fs.stat(itemFullPath);
                    if (itemStat.isDirectory()) {
                        profiles.profileFolders.push({
                            name: itemName,
                            path: itemFullPath
                        });
                        console.log(`[MainJS] Znaleziono podfolder-profil '${itemName}': ${itemFullPath}`);
                    }
                } catch (e) {
                }
            }
        } else {
            console.log(`[MainJS] Ścieżka ${baseOgulniegaProfileModsPath} istnieje, ale nie jest folderem.`);
        }
    } catch (err) {
        console.log(`[MainJS] Bazowy folder profili (python-like) ${baseOgulniegaProfileModsPath} nie istnieje lub brak dostępu.`);
    }
    
    console.log('[MainJS] Zwracane profile (python-like) do renderera:', profiles);
    return profiles;
});

ipcMain.handle('browse-for-directory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Wybierz folder docelowy'
  });
  if (canceled || filePaths.length === 0) {
    return null;
  } else {
    return filePaths[0];
  }
});

ipcMain.handle('download-file', async (event, { url, directoryPath, filename }) => {
  if (!fetch) {
    console.error('node-fetch is not loaded yet.');
    return { success: false, error: 'Moduł fetch nie jest załadowany.' };
  }
  const mainWindow = BrowserWindow.getFocusedWindow();
  const fullPath = path.join(directoryPath, filename);

  try {
    try {
        await fs.access(fullPath);
        const userResponse = await dialog.showMessageBox(mainWindow, {
            type: 'question',
            title: 'Plik już istnieje',
            message: `Plik "${filename}" już istnieje w folderze docelowym. Czy chcesz go nadpisać?`,
            buttons: ['Tak', 'Nie'],
            defaultId: 1,
            cancelId: 1 
        });
        if (userResponse.response === 1) {
            return { success: false, error: 'Pobieranie anulowane przez użytkownika (plik istnieje).' };
        }
    } catch (e) {
    }

    const response = await fetch(url, {
        headers: { 'User-Agent': 'ElectronPureJSModrinthApp/1.4 (FixedFilters-PythonProfiles)' }
    });

    if (!response.ok) {
      throw new Error(`Nie udało się pobrać pliku: ${response.statusText} (status: ${response.status})`);
    }

    const totalBytes = Number(response.headers.get('content-length') || 0);
    let receivedBytes = 0;

    mainWindow.webContents.send('download-started', { filename, totalBytes });

    const fileStream = require('fs').createWriteStream(fullPath); 
    
    response.body.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-progress', { filename, receivedBytes, totalBytes });
        }
    });

    await pipeline(response.body, fileStream);

    if (mainWindow && !mainWindow.isDestroyed()) {
         mainWindow.webContents.send('download-complete', { filename, path: fullPath });
    }
    return { success: true, path: fullPath };

  } catch (error) {
    console.error(`Błąd podczas pobierania pliku ${filename}:`, error);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-error', { filename, error: error.message });
    }
    return { success: false, error: error.message };
  }
});

ipcMain.on('show-error-message', (event, { title, content }) => {
    dialog.showErrorBox(title || 'Błąd', content || 'Wystąpił nieznany błąd.');
});

ipcMain.on('show-info-message', (event, { title, content }) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
        dialog.showMessageBox(focusedWindow, {
            type: 'info',
            title: title || 'Informacja',
            message: content || '',
            buttons: ['OK']
        });
    } else {
        console.info(`Info Message (no focused window): ${title} - ${content}`);
    }
});
