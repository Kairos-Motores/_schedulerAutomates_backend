import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// 📌 DEFINIÇÃO DE DIRETÓRIOS ES MODULES
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8000;

// 📌 DIRETÓRIOS E ARQUIVOS BASE
const BASE_SCRIPTS_DIR = 'C:/Automacoes';
const TASKS_FILE = path.join(__dirname, 'tasks.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');

// 🌐 ORIGENS PERMITIDAS
const ALLOWED_ORIGINS = [
    'https://scheduler-automates.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8000'
];

// 1. Configuração Robusta de CORS & PNA (Private Network Access)
app.use((req, res, next) => {
    const origin = req.headers.origin;

    // Permite requisições sem origem (Postman/Curl) ou origens permitidas
    if (!origin || ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.vercel.app')) {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }

    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Access-Control-Allow-Private-Network');

    // Libera comunicação de HTTPS (Vercel) para HTTP/Localhost
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    next();
});

// 2. Middlewares Globais
app.use(express.json());

// 📁 Garantia de existência de diretórios/arquivos base
if (!fs.existsSync(BASE_SCRIPTS_DIR)) fs.mkdirSync(BASE_SCRIPTS_DIR, { recursive: true });
if (!fs.existsSync(TASKS_FILE)) fs.writeFileSync(TASKS_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));

// 📖 Helper Genérico para Leitura de JSON
const readJsonFile = (filePath) => {
    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data || '[]');
    } catch {
        return [];
    }
};

const readTasksFromFile = () => readJsonFile(TASKS_FILE);
const readHistoryFromFile = () => readJsonFile(HISTORY_FILE);

// ✍️ Auxiliar para adicionar item no Histórico
const addHistoryEntry = (entry) => {
    try {
        const history = readHistoryFromFile();
        const newEntry = {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            ...entry
        };
        const trimmedHistory = [newEntry, ...history].slice(0, 500);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmedHistory, null, 2));
    } catch (err) {
        console.error('❌ Erro ao salvar histórico:', err.message);
    }
};

// 🛠️ AUXILIAR: GESTÃO INTELIGENTE DE AMBIENTE VIRTUAL (VENV)
const ensureVenvEnvironment = (scriptDir) => {
    const rootVenvDir = path.join(BASE_SCRIPTS_DIR, '.venv');
    const rootPython = path.join(rootVenvDir, 'Scripts', 'python.exe');

    const localVenvDir = path.join(scriptDir, '.venv');
    const localPython = path.join(localVenvDir, 'Scripts', 'python.exe');
    const localPip = path.join(localVenvDir, 'Scripts', 'pip.exe');
    const localReqFile = path.join(scriptDir, 'requirements.txt');

    if (fs.existsSync(localReqFile) && scriptDir !== BASE_SCRIPTS_DIR) {
        if (!fs.existsSync(localVenvDir)) {
            console.log(`📦 Criando ambiente local (.venv) em: ${scriptDir}...`);
            try {
                execSync(`python -m venv "${localVenvDir}"`, { cwd: scriptDir });
            } catch (err) {
                console.error(`❌ Erro ao criar .venv local:`, err.message);
                return 'python';
            }
        }

        const flagFile = path.join(localVenvDir, '.deps_installed');
        const reqModifiedTime = fs.statSync(localReqFile).mtimeMs;
        const lastInstalledTime = fs.existsSync(flagFile) ? Number(fs.readFileSync(flagFile, 'utf-8')) : 0;

        if (reqModifiedTime > lastInstalledTime) {
            console.log(`📥 Instalando/Atualizando bibliotecas do requirements.txt em ${scriptDir}...`);
            try {
                execSync(`"${localPip}" install -r "${localReqFile}" --quiet`, { cwd: scriptDir });
                fs.writeFileSync(flagFile, reqModifiedTime.toString());
                console.log(`✅ Bibliotecas instaladas com sucesso!`);
            } catch (err) {
                console.error(`⚠️ Erro ao instalar dependências:`, err.message);
            }
        }
        return `"${localPython}"`;
    }

    if (fs.existsSync(rootPython)) return `"${rootPython}"`;

    if (!fs.existsSync(rootVenvDir)) {
        console.log(`📦 Criando VENV compartilhada principal em: ${rootVenvDir}...`);
        try {
            execSync(`python -m venv "${rootVenvDir}"`);
            const rootPip = path.join(rootVenvDir, 'Scripts', 'pip.exe');
            const rootReq = path.join(BASE_SCRIPTS_DIR, 'requirements.txt');

            if (fs.existsSync(rootReq)) {
                execSync(`"${rootPip}" install -r "${rootReq}" --quiet`);
            }
            if (fs.existsSync(rootPython)) return `"${rootPython}"`;
        } catch (err) {
            console.error(`⚠️ Não foi possível criar VENV global. Usando Python do sistema.`, err.message);
        }
    }

    return 'python';
};

// 🔎 Mapeamento de imports para nomes de pacotes no PIP
const PACKAGE_MAP = {
    // 🟢 Corrigidos / Essenciais
    cv2: 'opencv-python',
    dotenv: 'python-dotenv',

    // 📊 Manipulação de Dados & Arquivos
    pandas: 'pandas',
    openpyxl: 'openpyxl',
    pyodbc: 'pyodbc',
    PIL: 'Pillow',
    docx: 'python-docx',
    xlsxwriter: 'xlsxwriter',
    yaml: 'pyyaml',
    fitz: 'PyMuPDF',

    // 🌐 Web & APIs
    requests: 'requests',
    bs4: 'beautifulsoup4',

    // ☁️ Azure & Cloud
    azure: 'azure-identity',
    'azure.identity': 'azure-identity',
    'azure.storage': 'azure-storage-blob',

    // 🤖 Machine Learning / Outros comuns
    sklearn: 'scikit-learn'
};

const installedPackagesCache = new Set();

// 🤖 AUTO-INSTALL INTELIGENTE DE MÓDULOS PYTHON
const autoInstallImports = (scriptPath, pythonExe) => {
    try {
        const content = fs.readFileSync(scriptPath, 'utf-8');
        const importRegex = /^\s*(?:import|from)\s+([a-zA-Z0-9_.]+)/gm;
        let match;
        const detectedModules = new Set();

        while ((match = importRegex.exec(content)) !== null) {
            const [fullMod] = match[1].split('.');
            detectedModules.add(fullMod);
        }

        const cleanPythonExe = pythonExe.replace(/"/g, '');
        const pipExe = cleanPythonExe.replace('python.exe', 'pip.exe');

        const nativeModules = new Set([
            'os', 'sys', 'json', 're', 'math', 'datetime', 'time',
            'pathlib', 'subprocess', 'urllib', 'shutil', 'typing',
            'io', 'csv', 'collections', 'random', 'base64', 'hashlib', 'codecs'
        ]);

        let installedInVenv = '';
        try {
            installedInVenv = execSync(`"${pipExe}" list`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).toLowerCase();
        } catch {
            installedInVenv = '';
        }

        detectedModules.forEach((mod) => {
            if (nativeModules.has(mod)) return;

            const packageName = PACKAGE_MAP[mod] || mod;
            const cacheKey = `${cleanPythonExe}_${packageName}`;

            if (installedPackagesCache.has(cacheKey)) return;

            if (installedInVenv.includes(packageName.toLowerCase())) {
                installedPackagesCache.add(cacheKey);
                return;
            }

            console.log(`📦 [Auto-Install] Módulo '${mod}' não encontrado. Instalando '${packageName}'...`);
            try {
                execSync(`"${pipExe}" install ${packageName}`, {
                    stdio: 'inherit',
                    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
                });
                installedPackagesCache.add(cacheKey);
                console.log(`✅ [Auto-Install] Pacote '${packageName}' instalado com sucesso!`);
            } catch (installErr) {
                console.error(`❌ [Auto-Install] Falha ao instalar '${packageName}':`, installErr.message);
            }
        });
    } catch (e) {
        console.error('⚠️ Não foi possível escanear imports do arquivo:', e.message);
    }
};

// 📁 ROTA: Seleção de arquivos via caixa do Windows (PowerShell)
app.post('/api/select-script', async (req, res) => {
    const uniqueId = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const tempPs1Path = path.join(__dirname, `temp_select_${uniqueId}.ps1`);

    const psScriptContent = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter = 'Scripts Python (*.py)|*.py|Arquivos Batch (*.bat)|*.bat|Executáveis (*.exe)|*.exe|Todos os Arquivos (*.*)|*.*'
$dialog.InitialDirectory = 'C:\\Automacoes'
$dialog.Title = 'Selecione a sua Automação'

$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true

$result = $dialog.ShowDialog($form)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.FileName
}
$form.Dispose()
`;

    try {
        fs.writeFileSync(tempPs1Path, psScriptContent, 'utf-8');
        const command = `powershell -NoProfile -ExecutionPolicy Bypass -File "${tempPs1Path}"`;

        const { stdout } = await execAsync(command, { timeout: 45000 });
        const selectedFullPath = stdout.trim();

        if (!selectedFullPath) return res.json({ canceled: true });

        return res.json({
            success: true,
            fullPath: selectedFullPath,
            fileName: path.basename(selectedFullPath)
        });
    } catch (error) {
        return res.status(500).json({ error: 'Seleção cancelada ou expirada' });
    } finally {
        if (fs.existsSync(tempPs1Path)) {
            try { fs.unlinkSync(tempPs1Path); } catch { }
        }
    }
});

// 🟢 GET: Buscar automações
app.get('/api/tasks', (req, res) => {
    res.json(readTasksFromFile());
});

// 🟡 POST: Salvar ou Atualizar automação
app.post('/api/tasks', (req, res) => {
    try {
        const newTask = req.body;
        const tasks = readTasksFromFile();
        const index = tasks.findIndex((t) => t.id === newTask.id);

        if (index !== -1) {
            tasks[index] = newTask;
        } else {
            tasks.push(newTask);
        }

        fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
        return res.json({ success: true, task: newTask });
    } catch {
        return res.status(500).json({ error: 'Erro ao salvar tarefa' });
    }
});

// 🔴 DELETE: Remover automação
app.delete('/api/tasks/:id', (req, res) => {
    try {
        const { id } = req.params;
        const tasks = readTasksFromFile().filter((t) => t.id !== id);
        fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
        return res.json({ success: true });
    } catch {
        return res.status(500).json({ error: 'Erro ao deletar tarefa' });
    }
});

// 📜 GET: Buscar Histórico
app.get('/api/history', (req, res) => {
    res.json(readHistoryFromFile());
});

// 📜 DELETE: Limpar Histórico
app.delete('/api/history', (req, res) => {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
        return res.json({ success: true });
    } catch {
        return res.status(500).json({ error: 'Erro ao limpar histórico' });
    }
});

// ⚡ POST: Executar automação
app.post('/api/tasks/run', async (req, res) => {
    const { scriptPath, taskId, taskTitle } = req.body;

    if (!scriptPath) {
        return res.status(400).json({ success: false, error: 'Caminho do script não informado.' });
    }

    const tasks = readTasksFromFile();
    const taskIndex = tasks.findIndex((t) => t.id === taskId || t.scriptPath === scriptPath);
    const taskObj = tasks[taskIndex] ?? null;

    const title = taskTitle || (taskObj?.title ?? 'Execução Manual');
    const fileName = path.basename(scriptPath);

    // 📌 TRATAMENTO INTELIGENTE DE CAMINHO ABSOLUTO (Evita duplicação C:/Automacoes/C:\...)
    const isAbsolutePath = /^[a-zA-Z]:[\\/]/.test(scriptPath) || scriptPath.startsWith('/') || path.isAbsolute(scriptPath);

    const fullScriptPath = isAbsolutePath
        ? path.normalize(scriptPath)
        : path.join(BASE_SCRIPTS_DIR, scriptPath);

    if (taskIndex !== -1) {
        tasks[taskIndex].status = 'processing';
        fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
    }

    if (!fs.existsSync(fullScriptPath)) {
        const errMsg = `Script não encontrado: ${fullScriptPath}`;

        if (taskIndex !== -1) {
            tasks[taskIndex].status = 'failed';
            fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
        }

        addHistoryEntry({
            taskId: taskId ?? null,
            title,
            fileName,
            scriptPath: fullScriptPath,
            status: 'failed',
            output: errMsg
        });

        return res.status(404).json({ success: false, error: errMsg });
    }

    const scriptDir = path.dirname(fullScriptPath);
    const fileExt = path.extname(fullScriptPath).toLowerCase();

    let command = '';

    if (['.bat', '.cmd', '.exe'].includes(fileExt)) {
        command = `"${fullScriptPath}"`;
        console.log(`▶ Executando EXECUTÁVEL/BATCH: ${fullScriptPath}`);
    } else {
        const pythonExe = ensureVenvEnvironment(scriptDir);
        autoInstallImports(fullScriptPath, pythonExe);

        command = `${pythonExe} "${fullScriptPath}"`;
        console.log(`▶ Executando PYTHON: ${fullScriptPath} usando [${pythonExe}]`);
    }

    try {
        const { stdout } = await execAsync(command, {
            cwd: scriptDir,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });

        const updatedTasks = readTasksFromFile();
        const currentTaskIdx = updatedTasks.findIndex((t) => t.id === taskId || t.scriptPath === scriptPath);

        if (currentTaskIdx !== -1) {
            updatedTasks[currentTaskIdx].status = 'success';
            fs.writeFileSync(TASKS_FILE, JSON.stringify(updatedTasks, null, 2));
        }

        addHistoryEntry({
            taskId: taskId ?? null,
            title,
            fileName,
            scriptPath: fullScriptPath,
            status: 'success',
            output: stdout || 'Executado com sucesso.'
        });

        return res.json({ success: true, output: stdout });
    } catch (error) {
        let errOutput = error.stderr || error.message;

        if (errOutput.includes('IM002') || errOutput.includes('SQLDriverConnect')) {
            errOutput = `⚠️ ERRO DE SISTEMA: O Driver ODBC do SQL Server não está instalado neste PC.\n\nInstale o 'ODBC Driver 17 for SQL Server' para habilitar a conexão.`;
        }

        const updatedTasks = readTasksFromFile();
        const currentTaskIdx = updatedTasks.findIndex((t) => t.id === taskId || t.scriptPath === scriptPath);

        if (currentTaskIdx !== -1) {
            updatedTasks[currentTaskIdx].status = 'failed';
            fs.writeFileSync(TASKS_FILE, JSON.stringify(updatedTasks, null, 2));
        }

        addHistoryEntry({
            taskId: taskId ?? null,
            title,
            fileName,
            scriptPath: fullScriptPath,
            status: 'failed',
            output: errOutput
        });

        return res.status(500).json({ success: false, error: errOutput });
    }
});

// 🚀 START SERVER
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`📁 Diretório padrão: ${BASE_SCRIPTS_DIR}`);
});