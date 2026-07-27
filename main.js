const { app, BrowserWindow, globalShortcut, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// ============================================
// ПОДКЛЮЧАЕМ МОДУЛЬ ОБНОВЛЕНИЙ
// ============================================
const updater = require('./updater.js');

// ============================================
// ЗАГРУЖАЕМ ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ ИЗ .env
// ============================================
require('dotenv').config();

// ============================================
// АВТО-СОЗДАНИЕ .env ДЛЯ ПОЛЬЗОВАТЕЛЕЙ
// ============================================
function ensureEnvFile() {
    try {
        // Путь к .env в папке с программой
        const envPath = path.join(process.cwd(), '.env');
        const resourcesPath = path.join(process.resourcesPath, 'app', '.env');
        
        // Если .env уже есть — ничего не делаем
        if (fs.existsSync(envPath)) {
            console.log('[ENV] .env найден в папке с программой');
            return;
        }

        // Пытаемся скопировать .env из ресурсов (если есть)
        if (app.isPackaged && fs.existsSync(resourcesPath)) {
            try {
                fs.copyFileSync(resourcesPath, envPath);
                console.log('[ENV] ✅ .env скопирован из ресурсов в:', envPath);
                return;
            } catch (e) {
                console.warn('[ENV] Не удалось скопировать .env:', e.message);
            }
        }

        // Если файла нет — создаем с дефолтными значениями
        console.log('[ENV] Создаем новый .env с дефолтными значениями...');
        
        // ⚠️ ВАЖНО: ЗАМЕНИ НА НОВЫЙ ТОКЕН!
        const defaultEnv = `# Discord Bot Token
DISCORD_BOT_TOKEN=MTQ3NzEyOTU2MjUyMDI5MzU4Nw.GFpD9G.pFIbGI6HYhJFoBBoqzzv8Jrh-YN24lKrGeiXww
DISCORD_CHANNEL_ID=1082856844004954182
`;

        fs.writeFileSync(envPath, defaultEnv);
        console.log('[ENV] ✅ .env создан автоматически в:', envPath);
        console.log('[ENV] ⚠️ ЗАМЕНИ ТОКЕН НА НОВЫЙ!');

    } catch (error) {
        console.error('[ENV] Ошибка создания .env:', error.message);
    }
}

// ============================================
// КОДИРОВКА КОНСОЛИ
// ============================================
if (process.platform === 'win32') {
    try {
        execSync('chcp 65001 > nul', { stdio: 'ignore' });
    } catch (e) {}
}

app.name = 'GTA Licenses';
app.disableHardwareAcceleration();

// ============================================
// ФИКС: ПОЛУЧЕНИЕ ПУТИ К USERDATA
// ============================================
function getUserDataPath() {
    try {
        return app.getPath('userData');
    } catch (e) {
        return path.join(process.env.APPDATA || process.env.HOME || '.', 'gta-licenses');
    }
}

const USER_DATA_PATH = getUserDataPath();
const keyFilePath = path.join(USER_DATA_PATH, 'license.key');

// ============================================
// ФИКС: БЕЗОПАСНЫЙ HWID
// ============================================
function getHWID() {
    const parts = [];
    
    try {
        try {
            const result = execSync('wmic baseboard get serialnumber', { 
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 3000 
            }).toString();
            const line = result.split('\n')[1]?.trim();
            if (line && line.length > 0) parts.push(line);
        } catch (e) {}

        try {
            const result = execSync('wmic cpu get processorid', {
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 3000
            }).toString();
            const line = result.split('\n')[1]?.trim();
            if (line && line.length > 0) parts.push(line);
        } catch (e) {}

        try {
            const result = execSync('wmic diskdrive get serialnumber', {
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 3000
            }).toString();
            const lines = result.split('\n').filter(l => l.trim());
            if (lines.length > 1) {
                const serial = lines[1].trim();
                if (serial && serial.length > 0) parts.push(serial);
            }
        } catch (e) {}

        try {
            const result = execSync('getmac /v /fo csv /nh', {
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 3000
            }).toString();
            const lines = result.split('\n').filter(l => l.trim());
            for (const line of lines) {
                const cols = line.split(',').map(c => c.replace(/"/g, '').trim());
                if (cols.length > 1 && cols[1] && cols[1].length > 0) {
                    parts.push(cols[1]);
                    break;
                }
            }
        } catch (e) {}

        if (parts.length === 0) {
            try {
                const installPath = app.getPath('exe');
                const hash = require('crypto').createHash('md5').update(installPath).digest('hex');
                parts.push(hash);
            } catch (e) {
                parts.push(`FALLBACK-${Date.now()}`);
            }
        }

        const hwid = parts.join('|');
        console.log(`[HWID] ${hwid.substring(0, 30)}...`);
        return hwid;

    } catch (error) {
        console.error('[HWID] Ошибка:', error.message);
        return `FALLBACK-${Date.now()}`;
    }
}

const HWID = getHWID();

// ============================================
// ФИКС: СОЗДАНИЕ ДИРЕКТОРИИ ДЛЯ LICENSE.KEY
// ============================================
function ensureUserDataDir() {
    try {
        if (!fs.existsSync(USER_DATA_PATH)) {
            fs.mkdirSync(USER_DATA_PATH, { recursive: true });
            console.log('[APP] Создана директория:', USER_DATA_PATH);
        }
    } catch (e) {
        console.error('[APP] Ошибка создания директории:', e.message);
    }
}

// ============================================
// ФУНКЦИИ РАБОТЫ С DISCORD
// ============================================

const https = require('https');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

if (!BOT_TOKEN || !CHANNEL_ID) {
    console.error('[ERROR] ❌ Отсутствуют переменные окружения!');
    console.error('[ERROR] Проверь файл .env в корне проекта');
    console.error('[ERROR] Нужны: DISCORD_BOT_TOKEN и DISCORD_CHANNEL_ID');
}

function httpsRequest(options, data = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => { responseData += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(responseData);
                    resolve({ statusCode: res.statusCode, data: json });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, data: responseData });
                }
            });
        });
        req.on('error', (error) => { reject(error); });
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('Таймаут подключения к Discord'));
        });
        if (data) { req.write(data); }
        req.end();
    });
}

async function getMessagesFromChannel(limit = 100) {
    try {
        console.log('[DISCORD] Загрузка сообщений...');
        const options = {
            hostname: 'discord.com',
            path: `/api/v10/channels/${CHANNEL_ID}/messages?limit=${limit}`,
            method: 'GET',
            headers: {
                'Authorization': `Bot ${BOT_TOKEN}`,
                'Content-Type': 'application/json',
            }
        };
        const result = await httpsRequest(options);
        if (result.statusCode !== 200) {
            if (result.statusCode === 404) throw new Error(`Канал ${CHANNEL_ID} не найден`);
            if (result.statusCode === 401) throw new Error('Неверный токен бота');
            if (result.statusCode === 403) throw new Error('Нет доступа к каналу');
            throw new Error(`Ошибка API: ${result.statusCode}`);
        }
        console.log(`[DISCORD] Получено ${result.data.length} сообщений`);
        return result.data;
    } catch (error) {
        console.error('[DISCORD] Ошибка:', error.message);
        throw error;
    }
}

async function sendMessageToChannel(message) {
    try {
        console.log('[DISCORD] Отправка сообщения...');
        const options = {
            hostname: 'discord.com',
            path: `/api/v10/channels/${CHANNEL_ID}/messages`,
            method: 'POST',
            headers: {
                'Authorization': `Bot ${BOT_TOKEN}`,
                'Content-Type': 'application/json',
            }
        };
        const result = await httpsRequest(options, JSON.stringify({ content: message }));
        if (result.statusCode !== 200) {
            throw new Error(`Ошибка отправки: ${result.statusCode}`);
        }
        console.log('[DISCORD] Сообщение отправлено');
        return result.data;
    } catch (error) {
        console.error('[DISCORD] Ошибка отправки:', error.message);
        return null;
    }
}

async function editMessage(messageId, newContent) {
    try {
        console.log('[DISCORD] Редактирование...');
        const options = {
            hostname: 'discord.com',
            path: `/api/v10/channels/${CHANNEL_ID}/messages/${messageId}`,
            method: 'PATCH',
            headers: {
                'Authorization': `Bot ${BOT_TOKEN}`,
                'Content-Type': 'application/json',
            }
        };
        const result = await httpsRequest(options, JSON.stringify({ content: newContent }));
        if (result.statusCode !== 200) {
            throw new Error(`Ошибка редактирования: ${result.statusCode}`);
        }
        console.log('[DISCORD] Сообщение отредактировано');
        return true;
    } catch (error) {
        console.error('[DISCORD] Ошибка редактирования:', error.message);
        return false;
    }
}

// ============================================
// ПРОВЕРКА КЛЮЧА
// ============================================

async function checkKeyInDiscord(key) {
    try {
        const messages = await getMessagesFromChannel(100);
        if (!messages) {
            return { valid: false, message: 'Ошибка получения сообщений' };
        }

        const keyMessage = messages.find(msg =>
            msg.content.includes(key) &&
            !msg.content.includes('[USED]') &&
            !msg.content.includes('[EXPIRED]')
        );

        if (!keyMessage) {
            const usedMessage = messages.find(msg =>
                msg.content.includes(key) &&
                (msg.content.includes('[ACTIVATED]') || msg.content.includes('[USED]'))
            );
            if (usedMessage) {
                if (usedMessage.content.includes(`HWID: ${HWID}`)) {
                    console.log('[LICENSE] Тот же ПК, ключ уже активирован');
                    const match = usedMessage.content.match(/Days: (\d+)/);
                    const days = match ? parseInt(match[1]) : 7;
                    const messageDate = new Date(usedMessage.timestamp);
                    const expiryDate = new Date(messageDate);
                    expiryDate.setDate(expiryDate.getDate() + days);
                    const now = new Date();
                    if (now > expiryDate) {
                        return { valid: false, message: 'Срок истек' };
                    }
                    const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
                    return {
                        valid: true,
                        message: `Ключ активирован на этом ПК! Осталось ${daysLeft} дн.`,
                        daysLeft: daysLeft,
                        expiryDate: expiryDate,
                        isSamePC: true
                    };
                }
                return { 
                    valid: false, 
                    message: 'Ключ уже использован на другом ПК' 
                };
            }
            return { valid: false, message: 'Ключ не найден' };
        }

        const match = keyMessage.content.match(/Days: (\d+)/);
        const days = match ? parseInt(match[1]) : 7;

        const messageDate = new Date(keyMessage.timestamp);
        const expiryDate = new Date(messageDate);
        expiryDate.setDate(expiryDate.getDate() + days);

        const now = new Date();
        if (now > expiryDate) {
            await editMessage(keyMessage.id, `${keyMessage.content}\n[EXPIRED] Срок истек!`);
            return { valid: false, message: 'Срок действия истек' };
        }

        const hasNotification = keyMessage.content.includes('[NOTIFIED]');

        let updatedContent = `${keyMessage.content}\n[ACTIVATED] ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
        updatedContent = `${updatedContent}\n[HWID] ${HWID}`;
        
        if (!hasNotification) {
            updatedContent = `${updatedContent}\n[NOTIFIED]`;
            await editMessage(keyMessage.id, updatedContent);
            await sendMessageToChannel(`🔑 Ключ **${key}** активирован! HWID: ${HWID.substring(0, 30)}...`);
            console.log(`[LICENSE] Уведомление отправлено для ${key}`);
        } else {
            if (keyMessage.content.includes(`HWID: ${HWID}`)) {
                console.log('[LICENSE] Тот же ПК, доступ разрешен');
            } else {
                await editMessage(keyMessage.id, `${keyMessage.content}\n[BLOCKED] Попытка с другого ПК`);
                return { 
                    valid: false, 
                    message: 'Ключ уже активирован на другом ПК' 
                };
            }
            await editMessage(keyMessage.id, updatedContent);
            console.log(`[LICENSE] Повторная проверка ${key}`);
        }

        const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
        return {
            valid: true,
            message: `Ключ активирован! Осталось ${daysLeft} дн.`,
            daysLeft: daysLeft,
            expiryDate: expiryDate
        };

    } catch (error) {
        console.error('[LICENSE] Ошибка:', error.message);
        return { valid: false, message: `Ошибка: ${error.message}` };
    }
}

// ============================================
// ЛОКАЛЬНОЕ ХРАНЕНИЕ
// ============================================

function saveActivation(key, expiryDate) {
    try {
        ensureUserDataDir();
        const data = {
            key: key,
            activated: new Date().toISOString(),
            expiryDate: expiryDate ? expiryDate.toISOString() : null,
            hwid: HWID
        };
        fs.writeFileSync(keyFilePath, JSON.stringify(data, null, 2), 'utf8');
        console.log(`[LICENSE] Сохранен: ${key}`);
        return true;
    } catch (error) {
        console.error('[LICENSE] Ошибка сохранения:', error.message);
        return false;
    }
}

function getLocalActivation() {
    try {
        if (!fs.existsSync(keyFilePath)) {
            console.log('[LICENSE] Файл не найден');
            return null;
        }
        const data = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
        if (!data.key) {
            console.warn('[LICENSE] Файл поврежден');
            clearLocalActivation();
            return null;
        }
        console.log(`[LICENSE] Найден локальный: ${data.key}`);
        return data;
    } catch (error) {
        console.warn('[LICENSE] Ошибка чтения:', error.message);
        clearLocalActivation();
        return null;
    }
}

function clearLocalActivation() {
    try {
        if (fs.existsSync(keyFilePath)) {
            fs.unlinkSync(keyFilePath);
            console.log('[LICENSE] Удален локальный');
        }
    } catch (error) {
        console.error('[LICENSE] Ошибка удаления:', error.message);
    }
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function getAppPath(relativePath) {
    if (app.isPackaged) {
        const possiblePaths = [
            path.join(process.resourcesPath, 'app', relativePath),
            path.join(process.resourcesPath, relativePath),
            path.join(path.dirname(app.getPath('exe')), relativePath),
            path.join(__dirname, relativePath)
        ];
        for (const testPath of possiblePaths) {
            if (fs.existsSync(testPath)) {
                return testPath;
            }
        }
        return path.join(__dirname, relativePath);
    } else {
        return path.join(__dirname, relativePath);
    }
}

function fileExists(filePath) {
    try {
        return fs.existsSync(filePath);
    } catch {
        return false;
    }
}

// ============================================
// ОСНОВНОЙ КОД
// ============================================

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    console.log('[APP] Уже запущено!');
    app.quit();
    process.exit(0);
}

app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        mainWindow.show();
    }
    if (authWindow) {
        if (authWindow.isMinimized()) authWindow.restore();
        authWindow.focus();
        authWindow.show();
    }
});

let mainWindow = null;
let authWindow = null;
let isVisible = true;
let isQuitting = false;

function createAuthWindow() {
    try {
        if (authWindow) {
            authWindow.focus();
            return;
        }

        const authHtmlPath = getAppPath('auth.html');
        
        authWindow = new BrowserWindow({
            width: 480,
            height: 450,
            transparent: true,
            frame: false,
            alwaysOnTop: true,
            resizable: false,
            skipTaskbar: false,
            backgroundColor: '#00000000',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: getAppPath('preload.js')
            }
        });

        if (fileExists(authHtmlPath)) {
            authWindow.loadFile(authHtmlPath);
        } else {
            authWindow.loadURL(`data:text/html,
                <!DOCTYPE html>
                <html>
                <head><style>
                    * { margin:0; padding:0; box-sizing:border-box; font-family:'Segoe UI',Arial,sans-serif; }
                    body { background:transparent; display:flex; justify-content:center; align-items:center; height:100vh; }
                    .window {
                        width: 420px;
                        background: rgba(8,8,20,0.88);
                        backdrop-filter: blur(14px);
                        border-radius: 16px;
                        border: 1px solid rgba(90,138,255,0.08);
                        padding: 30px 28px;
                        color: #dce4f0;
                        text-align: center;
                        box-shadow: 0 30px 80px rgba(0,0,0,0.8);
                    }
                    .window h1 { color: #5a8aff; font-size: 20px; margin-bottom: 6px; }
                    .window .sub { color: rgba(255,255,255,0.2); font-size: 12px; margin-bottom: 20px; }
                    .window input {
                        width: 100%;
                        padding: 12px;
                        background: rgba(255,255,255,0.05);
                        border: 1px solid rgba(90,138,255,0.12);
                        border-radius: 8px;
                        color: #dce4f0;
                        font-size: 14px;
                        outline: none;
                        text-align: center;
                        letter-spacing: 2px;
                    }
                    .window input:focus { border-color: rgba(90,138,255,0.3); }
                    .window .btn {
                        width: 100%;
                        padding: 12px;
                        margin-top: 12px;
                        background: rgba(90,138,255,0.1);
                        border: 1px solid rgba(90,138,255,0.15);
                        border-radius: 8px;
                        color: #5a8aff;
                        font-size: 14px;
                        cursor: pointer;
                        transition: 0.3s;
                    }
                    .window .btn:hover { background: rgba(90,138,255,0.15); }
                    .window .status { font-size: 13px; margin-top: 12px; min-height: 20px; }
                    .window .status.success { color: #4cd964; }
                    .window .status.error { color: #ff4757; }
                    .window .info { font-size: 10px; color: rgba(255,255,255,0.08); margin-top: 16px; border-top: 1px solid rgba(255,255,255,0.03); padding-top: 12px; }
                </style></head>
                <body>
                    <div class="window">
                        <h1>🔑 Активация</h1>
                        <div class="sub">Введите ключ доступа</div>
                        <input type="text" id="keyInput" placeholder="Введите ключ..." autocomplete="off">
                        <button class="btn" id="activateBtn">✅ Активировать</button>
                        <div class="status" id="statusMsg">Введите ключ</div>
                        <div class="info">Ключ можно получить у администратора</div>
                    </div>
                    <script>
                        const keyInput = document.getElementById('keyInput');
                        const activateBtn = document.getElementById('activateBtn');
                        const statusMsg = document.getElementById('statusMsg');

                        function setStatus(type, msg) {
                            statusMsg.textContent = msg;
                            statusMsg.className = 'status ' + type;
                        }

                        window.electronAPI.checkLicense();

                        window.electronAPI.onLicenseStatus((status) => {
                            if (status.valid) {
                                setStatus('success', '✅ ' + status.message);
                                setTimeout(() => window.electronAPI.closeWindow(), 1500);
                            } else {
                                setStatus('error', 'ℹ️ ' + status.message);
                            }
                        });

                        window.electronAPI.onActivationResult((result) => {
                            if (result.success) {
                                setStatus('success', '✅ ' + result.message);
                                setTimeout(() => window.electronAPI.closeWindow(), 1500);
                            } else {
                                setStatus('error', '❌ ' + result.message);
                                keyInput.value = '';
                                keyInput.focus();
                            }
                        });

                        window.electronAPI.onLicenseReady(() => { window.electronAPI.closeWindow(); });

                        function activate() {
                            const key = keyInput.value.trim().toUpperCase();
                            if (!key) { setStatus('error', '⚠️ Введите ключ'); return; }
                            setStatus('success', '⏳ Проверка...');
                            window.electronAPI.activateLicense(key);
                        }

                        activateBtn.addEventListener('click', activate);
                        keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') activate(); });
                        setTimeout(() => keyInput.focus(), 300);
                    <\/script>
                </body>
                </html>
            `);
        }

        authWindow.setBackgroundColor('#00000000');
        authWindow.setAlwaysOnTop(true, 'screen-saver');
        authWindow.setMenu(null);

        authWindow.on('closed', () => {
            authWindow = null;
            if (!isQuitting) app.quit();
        });

        console.log('[WINDOW] Окно активации создано');
    } catch (error) {
        console.error('[WINDOW] Ошибка:', error.message);
    }
}

function createMainWindow() {
    try {
        if (mainWindow) {
            mainWindow.focus();
            return;
        }

        const lawsHtmlPath = getAppPath('laws.html');
        
        if (!fileExists(lawsHtmlPath)) {
            console.error('[WINDOW] laws.html не найден!');
            createAuthWindow();
            return;
        }

        mainWindow = new BrowserWindow({
            width: 1300,
            height: 850,
            transparent: true,
            frame: false,
            alwaysOnTop: true,
            resizable: true,
            skipTaskbar: true,
            focusable: false,
            backgroundColor: '#00000000',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: getAppPath('preload.js'),
                sandbox: false
            }
        });

        mainWindow.setTitle('GTA Licenses');
        mainWindow.loadFile(lawsHtmlPath);
        mainWindow.setBackgroundColor('#00000000');
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.setMenu(null);
        mainWindow.setVisibleOnAllWorkspaces(true);
        mainWindow.setIgnoreMouseEvents(false);

        mainWindow.on('closed', () => { mainWindow = null; });

        const menu = Menu.buildFromTemplate([
            {
                label: '📋 Программа',
                submenu: [
                    {
                        label: `Версия ${updater.CURRENT_VERSION}`,
                        enabled: false
                    },
                    {
                        type: 'separator'
                    },
                    {
                        label: '🔍 Проверить обновления',
                        click: () => {
                            updater.checkForUpdatesManual(mainWindow);
                        }
                    },
                    {
                        type: 'separator'
                    },
                    {
                        label: '❌ Выйти',
                        click: () => {
                            app.quit();
                        }
                    }
                ]
            }
        ]);
        Menu.setApplicationMenu(menu);

        mainWindow.webContents.on('did-finish-load', () => {
            const local = getLocalActivation();
            if (local && local.expiryDate) {
                const now = new Date();
                const expiry = new Date(local.expiryDate);
                if (now <= expiry) {
                    mainWindow.webContents.executeJavaScript(`
                        localStorage.setItem('licenseData', JSON.stringify({
                            key: '${local.key}',
                            expiryDate: '${local.expiryDate}',
                            isValid: true
                        }));
                        if (typeof window.startTimerTop === 'function') {
                            window.startTimerTop();
                        }
                    `);
                    console.log('[WINDOW] Данные переданы');
                } else {
                    clearLocalActivation();
                    mainWindow.close();
                    createAuthWindow();
                }
            }
        });

        setTimeout(() => {
            updater.checkForUpdates(mainWindow);
        }, 3000);

        globalShortcut.register('F7', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                isVisible = !isVisible;
                if (isVisible) {
                    mainWindow.show();
                    mainWindow.setIgnoreMouseEvents(false);
                } else {
                    mainWindow.hide();
                    mainWindow.blur();
                }
            }
        });

        console.log('[WINDOW] Главное окно создано (F7)');
    } catch (error) {
        console.error('[WINDOW] Ошибка:', error.message);
        createAuthWindow();
    }
}

// ============================================
// IPC ОБРАБОТЧИКИ
// ============================================

ipcMain.on('check-license', async (event) => {
    const local = getLocalActivation();
    if (!local) {
        event.reply('license-status', {
            valid: false,
            status: 'not_found',
            message: 'Требуется активация'
        });
        return;
    }

    try {
        if (local.expiryDate) {
            const now = new Date();
            const expiry = new Date(local.expiryDate);
            if (now > expiry) {
                clearLocalActivation();
                event.reply('license-status', {
                    valid: false,
                    status: 'expired',
                    message: 'Срок истек'
                });
                return;
            }
            const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
            event.reply('license-status', {
                valid: true,
                key: local.key,
                daysLeft: daysLeft,
                status: 'active',
                message: `Активна (осталось ${daysLeft} дн.)`,
                expiryDate: local.expiryDate
            });
            return;
        }

        const result = await checkKeyInDiscord(local.key);
        if (result.valid) {
            if (result.expiryDate) {
                saveActivation(local.key, result.expiryDate);
            }
            event.reply('license-status', {
                valid: true,
                key: local.key,
                daysLeft: result.daysLeft,
                status: 'active',
                message: result.message,
                expiryDate: result.expiryDate ? result.expiryDate.toISOString() : null
            });
        } else {
            clearLocalActivation();
            event.reply('license-status', {
                valid: false,
                status: 'expired',
                message: result.message || 'Недействительный ключ'
            });
        }
    } catch (error) {
        event.reply('license-status', {
            valid: false,
            status: 'error',
            message: `Ошибка: ${error.message}`
        });
    }
});

ipcMain.on('activate-license', async (event, key) => {
    key = key.toUpperCase().trim();
    if (!key) {
        event.reply('activation-result', { success: false, message: 'Введите ключ' });
        return;
    }

    const local = getLocalActivation();
    if (local && local.key === key && local.expiryDate) {
        const now = new Date();
        const expiry = new Date(local.expiryDate);
        if (now <= expiry) {
            event.reply('activation-result', {
                success: true,
                message: `Уже активна (до ${expiry.toLocaleDateString()})`
            });
            setTimeout(() => {
                if (authWindow) authWindow.close();
                if (!mainWindow) createMainWindow();
                event.reply('license-ready', true);
            }, 1500);
            return;
        }
    }

    try {
        const result = await checkKeyInDiscord(key);
        if (result.valid) {
            saveActivation(key, result.expiryDate || null);
            event.reply('activation-result', {
                success: true,
                message: result.message,
                expiryDate: result.expiryDate ? result.expiryDate.toISOString() : null
            });
            setTimeout(() => {
                if (authWindow) authWindow.close();
                if (!mainWindow) createMainWindow();
                event.reply('license-ready', true);
            }, 1500);
        } else {
            event.reply('activation-result', {
                success: false,
                message: result.message || 'Неверный ключ'
            });
        }
    } catch (error) {
        event.reply('activation-result', {
            success: false,
            message: `Ошибка: ${error.message}`
        });
    }
});

ipcMain.on('close-window', () => {
    if (!isQuitting) { isQuitting = true; app.quit(); }
});

ipcMain.on('check-updates', (event) => {
    console.log('[APP] Ручная проверка обновлений');
    try {
        updater.checkForUpdatesManual(mainWindow);
        event.reply('update-result', { hasUpdate: false, message: 'Проверка выполнена' });
    } catch (error) {
        event.reply('update-result', { error: true, message: error.message });
    }
});

ipcMain.on('get-version', (event) => {
    event.reply('version-info', updater.CURRENT_VERSION);
});

// ============================================
// ЗАПУСК
// ============================================

app.whenReady().then(async () => {
    console.log('[APP] Запуск GTA Licenses...');
    console.log(`[VERSION] ${updater.CURRENT_VERSION}`);

    // ============================================
    // 🔐 СОЗДАЕМ .env ЕСЛИ ЕГО НЕТ
    // ============================================
    ensureEnvFile();

    ensureUserDataDir();

    console.log(`[HWID] ${HWID.substring(0, 30)}...`);

    const local = getLocalActivation();
    
    if (local && local.expiryDate) {
        const now = new Date();
        const expiry = new Date(local.expiryDate);
        if (now <= expiry) {
            console.log(`[LICENSE] Активна до ${expiry.toLocaleDateString()}`);
            createMainWindow();
            return;
        } else {
            clearLocalActivation();
            console.log('[LICENSE] Локальная истекла');
        }
    }

    let discordAvailable = false;
    try {
        const test = await getMessagesFromChannel(1);
        if (test) {
            discordAvailable = true;
            console.log('[DISCORD] Бот подключен');
        }
    } catch (e) {
        console.log(`[DISCORD] Ошибка: ${e.message}`);
        console.log('[DISCORD] Работа в офлайн-режиме');
    }

    if (local && !local.expiryDate) {
        try {
            if (discordAvailable) {
                const result = await checkKeyInDiscord(local.key);
                if (result.valid) {
                    if (result.expiryDate) {
                        saveActivation(local.key, result.expiryDate);
                    }
                    createMainWindow();
                    return;
                } else {
                    clearLocalActivation();
                }
            }
        } catch (e) {
            console.warn('[LICENSE] Ошибка проверки:', e.message);
            clearLocalActivation();
        }
    }

    console.log('[APP] Требуется активация');
    createAuthWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !isQuitting) {
        isQuitting = true;
        app.quit();
    }
});

app.on('before-quit', () => {
    isQuitting = true;
    globalShortcut.unregisterAll();
});

process.on('uncaughtException', (error) => {
    console.error('[ERROR]', error.message);
});