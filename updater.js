// updater.js
const { autoUpdater } = require('electron-updater');
const { app, dialog, BrowserWindow } = require('electron');
const log = require('electron-log');

// ============================================
// НАСТРОЙКА ЛОГИРОВАНИЯ
// ============================================
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

autoUpdater.logger = log;
autoUpdater.autoDownload = false; // Спрашиваем перед скачиванием
autoUpdater.autoInstallOnAppQuit = true; // Устанавливаем при выходе

// ============================================
// ТЕКУЩАЯ ВЕРСИЯ (ДОЛЖНА СОВПАДАТЬ С package.json)
// ============================================
const CURRENT_VERSION = app.getVersion();

// ============================================
// ОСНОВНАЯ ФУНКЦИЯ ПРОВЕРКИ
// ============================================
function checkForUpdates(mainWindow) {
    log.info('🔍 Проверка обновлений...');
    log.info(`📌 Текущая версия: ${CURRENT_VERSION}`);
    
    // Запускаем проверку
    autoUpdater.checkForUpdatesAndNotify();
    
    // ============================================
    // ОБРАБОТЧИКИ СОБЫТИЙ
    // ============================================
    
    // 1. Обновление найдено
    autoUpdater.on('update-available', (info) => {
        log.info(`✅ Найдено обновление: ${info.version}`);
        
        const dialogOpts = {
            type: 'info',
            title: '🔔 Доступно обновление',
            message: `Версия ${info.version} доступна для скачивания`,
            detail: `Текущая версия: ${CURRENT_VERSION}\nНовая версия: ${info.version}\n\nЧто нового:\n${info.releaseNotes || 'Исправлены ошибки и улучшена производительность'}`,
            buttons: ['⬇️ Скачать', '⏰ Напомнить позже'],
            defaultId: 0,
            cancelId: 1
        };
        
        dialog.showMessageBox(mainWindow, dialogOpts).then(({ response }) => {
            if (response === 0) {
                log.info('📥 Начинаем скачивание...');
                autoUpdater.downloadUpdate();
            } else {
                log.info('⏰ Обновление отложено');
                // Проверим через 24 часа
                setTimeout(() => checkForUpdates(mainWindow), 24 * 60 * 60 * 1000);
            }
        });
    });
    
    // 2. Обновлений нет
    autoUpdater.on('update-not-available', () => {
        log.info('✅ Обновлений нет');
        // Показываем сообщение только при ручной проверке
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-status', {
                status: 'no-updates',
                message: 'У вас последняя версия'
            });
        }
    });
    
    // 3. Скачивание началось
    autoUpdater.on('download-progress', (progressObj) => {
        let logMessage = `📥 Скачивание: ${progressObj.percent}%`;
        logMessage += ` (${progressObj.transferred}/${progressObj.total})`;
        log.info(logMessage);
        
        // Отправляем прогресс в окно (для отображения в UI)
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-progress', {
                percent: progressObj.percent,
                transferred: progressObj.transferred,
                total: progressObj.total,
                bytesPerSecond: progressObj.bytesPerSecond
            });
        }
    });
    
    // 4. Скачивание завершено
    autoUpdater.on('update-downloaded', (info) => {
        log.info(`✅ Обновление ${info.version} скачано!`);
        
        const dialogOpts = {
            type: 'info',
            title: '🎉 Обновление готово к установке',
            message: 'Установить обновление сейчас?',
            detail: `Версия ${info.version} скачана и готова к установке.\nПриложение будет перезапущено.`,
            buttons: ['🔄 Установить сейчас', '📅 Установить при выходе'],
            defaultId: 0,
            cancelId: 1
        };
        
        dialog.showMessageBox(mainWindow, dialogOpts).then(({ response }) => {
            if (response === 0) {
                log.info('🔄 Устанавливаем обновление...');
                setImmediate(() => {
                    autoUpdater.quitAndInstall();
                });
            } else {
                log.info('📅 Установка отложена до выхода');
                autoUpdater.autoInstallOnAppQuit = true;
            }
        });
    });
    
    // 5. Ошибка
    autoUpdater.on('error', (error) => {
        log.error('❌ Ошибка обновления:', error);
        
        const dialogOpts = {
            type: 'error',
            title: '❌ Ошибка обновления',
            message: 'Не удалось проверить обновления',
            detail: error.message || 'Проверьте подключение к интернету',
            buttons: ['OK']
        };
        
        if (mainWindow && !mainWindow.isDestroyed()) {
            dialog.showMessageBox(mainWindow, dialogOpts);
        }
    });
}

// ============================================
// РУЧНАЯ ПРОВЕРКА (ДЛЯ КНОПКИ)
// ============================================
function checkForUpdatesManual(mainWindow) {
    log.info('👆 Ручная проверка обновлений');
    autoUpdater.checkForUpdates();
}

// ============================================
// ЭКСПОРТ
// ============================================
module.exports = {
    checkForUpdates,
    checkForUpdatesManual,
    CURRENT_VERSION
};