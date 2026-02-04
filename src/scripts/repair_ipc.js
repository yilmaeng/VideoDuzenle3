const fs = require('fs');
const path = require('path');

const targetPath = path.join('c:/Users/engin/OneDrive/Belgeler/KorculVideoEditor/src/main/ipc-handlers.js');

try {
    let content = fs.readFileSync(targetPath, 'utf-8');

    // Restore 'fs' import if missing
    if (!content.includes("require('fs')")) {
        content = content.replace("const path = require('path');", "const path = require('path');\nconst fs = require('fs');");
    }

    // Restore 'os' import if missing
    if (!content.includes("require('os')")) {
        content = content.replace("const fs = require('fs');", "const fs = require('fs');\nconst os = require('os');");
    }

    // Check if setupIpcHandlers function is missing
    if (!content.includes("function setupIpcHandlers(mainWindow) {")) {
        // Construct the block to insert
        const block = `
// const geminiHandler = require('./gemini-handler'); // Removed to prevent duplicate registration

function setupIpcHandlers(mainWindow) {
    // Gemini handlers are already set up in index.js via gemini-handler module

    // Pencere başlığını ayarla
    ipcMain.on('set-window-title', (event, title) => {
        if (mainWindow) {
            mainWindow.setTitle(title);
        }
    });

    // --- DIALOG HANDLERS ---
    
    // Dosya açma diyaloğu
    ipcMain.handle('open-file-dialog', async (event, options) => {
        const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
        const result = await dialog.showOpenDialog(win, options);
        return result;
    });

    // Kaydetme diyaloğu
    ipcMain.handle('show-save-dialog', async (event, options) => {
        const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
        const result = await dialog.showSaveDialog(win, options);
        return result; 
    });
    // --- END DIALOG HANDLERS ---

    // Video metadata al (ve Probe)
    ipcMain.handle('get-video-metadata', async (event, filePath) => {
        try {
            const metadata = await ffmpegHandler.getVideoMetadata(filePath);
            return { success: true, data: metadata };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
`;
        // Insert it before the first handler (preview-tts)
        // Or after the imports
        const insertPoint = "const os = require('os');";
        if (content.includes(insertPoint)) {
            content = content.replace(insertPoint, insertPoint + "\n" + block);
        } else {
            // Fallback
            content = content.replace("const path = require('path');", "const path = require('path');\nconst fs = require('fs');\nconst os = require('os');\n" + block);
        }
    }

    fs.writeFileSync(targetPath, content, 'utf-8');
    console.log('Successfully repaired ipc-handlers.js');

} catch (err) {
    console.error('Error repairing file:', err);
}
