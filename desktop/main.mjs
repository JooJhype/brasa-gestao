import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server.mjs';

const desktopDir = path.dirname(fileURLToPath(import.meta.url));

app.setName('Brasa Protótipo');
const userDataDir = path.join(app.getPath('appData'), 'Brasa Prototipo');
try {
  mkdirSync(userDataDir, { recursive: true });
  app.setPath('userData', userDataDir);
} catch (error) {
  dialog.showErrorBox(
    'Não foi possível iniciar o Brasa',
    'Não foi possível acessar a pasta de dados do seu usuário. Confira as permissões do Windows e tente novamente.\n\nDetalhe: ' +
      error.message,
  );
  app.exit(1);
}
if (process.platform === 'win32') app.setAppUserModelId('com.brasa.prototipo');

const dataDir = process.env.BRASA_DESKTOP_DATA_DIR
  ? path.resolve(process.env.BRASA_DESKTOP_DATA_DIR)
  : path.join(app.getPath('userData'), 'dados');

let mainWindow;
let localServer;
let startupPromise;
let shutdownPromise;
let quitting = false;
const activeDownloads = new Set();

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isLocalUrl(value) {
  const url = parseUrl(value);
  return Boolean(
    localServer &&
    url &&
    url.origin === new URL(localServer.url).origin &&
    !url.username &&
    !url.password,
  );
}

async function openExternal(value) {
  const url = parseUrl(value);
  if (!url || url.protocol !== 'https:' || url.username || url.password) return;
  try {
    await shell.openExternal(url.href);
  } catch (error) {
    console.error('Não foi possível abrir o link no navegador.', error);
    if (!quitting)
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Brasa',
        message: 'Não foi possível abrir o link.',
        detail: 'Confira se há um navegador instalado e tente novamente.',
      });
  }
}

function focusWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  quitting = true;
  shutdownPromise = (async () => {
    let exitCode = 0;
    try {
      await startupPromise?.catch(() => {});
      for (const download of activeDownloads) download.cancel();
      if (localServer) await localServer.close();
    } catch (error) {
      exitCode = 1;
      console.error('Falha ao encerrar o Brasa.', error);
    } finally {
      app.exit(exitCode);
    }
  })();
  return shutdownPromise;
}

function installMenu() {
  const withWindow = (action) => () => {
    if (!quitting && mainWindow && !mainWindow.isDestroyed()) action(mainWindow);
  };
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Exportar backup…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: withWindow((win) => win.webContents.downloadURL(`${localServer.url}/api/export`)),
        },
        {
          label: 'Importar backup…',
          click: withWindow((win) => {
            void win.loadURL(`${localServer.url}/#settings`);
          }),
        },
        {
          label: 'Abrir pasta dos dados',
          click: async () => {
            const error = await shell.openPath(dataDir);
            if (error && !quitting)
              await dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'Brasa',
                message: 'Não foi possível abrir a pasta dos dados.',
                detail: error,
              });
          },
        },
        { type: 'separator' },
        { label: 'Sair', accelerator: 'Alt+F4', click: () => app.quit() },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { label: 'Desfazer', role: 'undo' },
        { label: 'Refazer', role: 'redo' },
        { type: 'separator' },
        { label: 'Recortar', role: 'cut' },
        { label: 'Copiar', role: 'copy' },
        { label: 'Colar', role: 'paste' },
        { label: 'Selecionar tudo', role: 'selectAll' },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { label: 'Recarregar', role: 'reload' },
        { type: 'separator' },
        { label: 'Aumentar zoom', role: 'zoomIn' },
        { label: 'Diminuir zoom', role: 'zoomOut' },
        { label: 'Restaurar zoom', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Tela cheia', role: 'togglefullscreen' },
        ...(!app.isPackaged
          ? [
              { type: 'separator' },
              { label: 'Ferramentas de desenvolvimento', role: 'toggleDevTools' },
            ]
          : []),
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Sobre o Brasa',
          click: async () => {
            if (quitting) return;
            await dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Sobre o Brasa',
              message: 'Brasa · Gestão de hamburgueria',
              detail: `Versão ${app.getVersion()}\nEstoque, fichas técnicas, custos e vendas.\nSeus dados ficam neste computador.`,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function configureSession(win) {
  const session = win.webContents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.on('will-download', (event, item, contents) => {
    const url = parseUrl(item.getURL());
    if (
      contents !== win.webContents ||
      !isLocalUrl(item.getURL()) ||
      !['/api/export', '/api/csv'].includes(url?.pathname)
    ) {
      event.preventDefault();
      return;
    }
    const extension = url.pathname === '/api/export' ? 'json' : 'csv';
    const filename = path.basename(item.getFilename()).replace(/[^A-Za-z0-9._-]/g, '_');
    item.setSaveDialogOptions({
      title: extension === 'json' ? 'Salvar backup do Brasa' : 'Salvar relatório financeiro',
      defaultPath: path.join(app.getPath('downloads'), filename || `brasa-exportacao.${extension}`),
      buttonLabel: 'Salvar',
      filters: [
        {
          name: extension === 'json' ? 'Backup do Brasa' : 'Planilha CSV',
          extensions: [extension],
        },
      ],
    });
    activeDownloads.add(item);
    item.once('done', async (_event, state) => {
      activeDownloads.delete(item);
      if (state !== 'interrupted' || quitting || win.isDestroyed()) return;
      await dialog.showMessageBox(win, {
        type: 'error',
        title: 'Brasa',
        message: 'Não foi possível salvar o arquivo.',
        detail: 'Tente exportar novamente e escolha uma pasta em que você possa salvar arquivos.',
      });
    });
  });
}

async function createWindow() {
  const icon = path.join(
    desktopDir,
    'assets',
    process.platform === 'win32' ? 'brasa-icon.ico' : 'brasa-icon.png',
  );
  const win = new BrowserWindow({
    title: 'Brasa',
    width: 1360,
    height: 900,
    minWidth: 760,
    minHeight: 600,
    backgroundColor: '#f5f1e9',
    show: false,
    autoHideMenuBar: false,
    ...(existsSync(icon) ? { icon } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  });
  mainWindow = win;
  configureSession(win);
  win.on('page-title-updated', (event) => {
    event.preventDefault();
    win.setTitle('Brasa');
  });
  win.once('ready-to-show', () => {
    if (!quitting && !win.isDestroyed()) win.show();
  });
  win.on('closed', () => {
    mainWindow = undefined;
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.on('will-frame-navigate', (event) => {
    if (isLocalUrl(event.url)) return;
    event.preventDefault();
    if (event.isMainFrame) void openExternal(event.url);
  });
  win.webContents.on('will-redirect', (event) => {
    if (!isLocalUrl(event.url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalUrl(url)) {
      const target = parseUrl(url);
      if (['/api/export', '/api/csv'].includes(target.pathname)) win.webContents.downloadURL(url);
      else void win.loadURL(url);
    } else void openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    if (quitting || details.reason === 'clean-exit') return;
    dialog.showErrorBox(
      'Brasa',
      'A janela do Brasa foi encerrada inesperadamente. Abra o aplicativo novamente para continuar. Os lançamentos já confirmados permanecem salvos.',
    );
    app.quit();
  });
  await win.loadURL(`${localServer.url}/#dashboard`);
}

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', focusWindow);
  app.on('activate', focusWindow);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    event.preventDefault();
    void shutdown();
  });
  startupPromise = app.whenReady().then(async () => {
    if (quitting) return;
    mkdirSync(dataDir, { recursive: true });
    localServer = await startServer({ port: 0, dataDir });
    if (quitting) return;
    installMenu();
    await createWindow();
  });
  startupPromise.catch((error) => {
    console.error('Falha ao iniciar o Brasa.', error);
    if (!quitting)
      dialog.showErrorBox(
        'Não foi possível iniciar o Brasa',
        'O aplicativo não conseguiu abrir seus arquivos ou carregar a janela. Confira se a pasta de dados está acessível e tente novamente.\n\nDetalhe: ' +
          error.message,
      );
    app.quit();
  });
}
