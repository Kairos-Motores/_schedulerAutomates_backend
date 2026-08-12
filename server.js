import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 8000;

// 📌 DIRETÓRIOS E ARQUIVOS BASE
const BASE_SCRIPTS_DIR = 'C:/Automacoes';
const TASKS_FILE = path.join(__dirname, 'tasks.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');

app.use(cors());
app.use(express.json());

// Garante que a pasta e os arquivos JSON existam
if (!fs.existsSync(BASE_SCRIPTS_DIR)) {
    fs.mkdirSync(BASE_SCRIPTS_DIR, { recursive: true });
}
if (!fs.existsSync(TASKS_FILE)) {
    fs.writeFileSync(TASKS_FILE, JSON.stringify([], null, 2));
}
if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
}

// 📖 Auxiliares para leitura
const readTasksFromFile = () => {
    try {
        const data = fs.readFileSync(TASKS_FILE, 'utf-8');
        return JSON.parse(data || '[]');
    } catch (err) {
        return [];
    }
};

const readHistoryFromFile = () => {
    try {
        const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
        return JSON.parse(data || '[]');
    } catch (err) {
        return [];
    }
};

// ✍️ Auxiliar para adicionar item no Histórico
const addHistoryEntry = (entry) => {
    try {
        const history = readHistoryFromFile();
        history.unshift({
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            ...entry
        });
        const trimmedHistory = history.slice(0, 500);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmedHistory, null, 2));
    } catch (err) {
        console.error('❌ Erro ao salvar histórico:', err);
    }
};

// 🛠️ AUXILIAR: GESTÃO INTELIGENTE DE AMBIENTE VIRTUAL (VENV + REQUIREMENTS)
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
        let reqModifiedTime = fs.statSync(localReqFile).mtimeMs;
        let lastInstalledTime = fs.existsSync(flagFile) ? Number(fs.readFileSync(flagFile, 'utf-8')) : 0;

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

    if (fs.existsSync(rootPython)) {
        return `"${rootPython}"`;
    }

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
    'pandas': 'pandas',
    'openpyxl': 'openpyxl',
    'pyodbc': 'pyodbc',
    'azure': 'azure-identity',
    'azure.identity': 'azure-identity',
    'azure.storage': 'azure-storage-blob',
    'requests': 'requests',
    'bs4': 'beautifulsoup4',
    'cv2': 'opencv-python',
    'PIL': 'Pillow',
    'docx': 'python-docx'
};

// ⚡ CACHE EM MEMÓRIA: Evita re-verificar pacotes já validados na sessão atual do servidor
const installedPackagesCache = new Set();

// 🤖 AUTO-INSTALL INTELIGENTE: Só instala o que REALMENTE estiver faltando na VENV
function autoInstallImports(scriptPath, pythonExe) {
    try {
        const content = fs.readFileSync(scriptPath, 'utf-8');
        const importRegex = /^\s*(?:import|from)\s+([a-zA-Z0-9_.]+)/gm;
        let match;
        const detectedModules = new Set();

        while ((match = importRegex.exec(content)) !== null) {
            const fullMod = match[1];
            const baseMod = fullMod.split('.')[0];
            detectedModules.add(baseMod); // Foca no módulo principal
        }

        const cleanPythonExe = pythonExe.replace(/"/g, '');
        const pipExe = cleanPythonExe.replace('python.exe', 'pip.exe');

        const nativeModules = [
            'os', 'sys', 'json', 're', 'math', 'datetime', 'time',
            'pathlib', 'subprocess', 'urllib', 'shutil', 'typing',
            'io', 'csv', 'collections', 'random', 'base64', 'hashlib', 'codecs'
        ];

        // 1️⃣ Pega a lista de pacotes instalados na VENV de uma só vez
        let installedInVenv = '';
        try {
            installedInVenv = execSync(`"${pipExe}" list`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).toLowerCase();
        } catch (e) {
            installedInVenv = '';
        }

        detectedModules.forEach(mod => {
            if (nativeModules.includes(mod)) return;

            const packageName = PACKAGE_MAP[mod] || mod;
            const cacheKey = `${cleanPythonExe}_${packageName}`;

            // 2️⃣ Se já foi validado nesta sessão, ignora!
            if (installedPackagesCache.has(cacheKey)) return;

            // 3️⃣ Se o 'pip list' mostra que já está instalado, salva no cache e ignora!
            if (installedInVenv.includes(packageName.toLowerCase())) {
                installedPackagesCache.add(cacheKey);
                return;
            }

            // 4️⃣ Só executa a instalação se realmente NÃO constar no pip list:
            console.log(`📦 [Auto-Install] Módulo '${mod}' não encontrado na VENV. Instalando '${packageName}'...`);
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
}

// 📁 ROTA: Seleção de arquivos via janela do Windows (PowerShell Dialog)
app.post('/api/select-script', (req, res) => {
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
    } catch (fsErr) {
        return res.status(500).json({ error: 'Erro ao criar seletor' });
    }

    const command = `powershell -NoProfile -ExecutionPolicy Bypass -File "${tempPs1Path}"`;

    exec(command, { timeout: 45000 }, (error, stdout) => {
        if (fs.existsSync(tempPs1Path)) {
            try { fs.unlinkSync(tempPs1Path); } catch (e) { }
        }

        if (error) {
            return res.status(500).json({ error: 'Seleção cancelada ou expirada' });
        }

        const selectedFullPath = stdout.trim();
        if (!selectedFullPath) return res.json({ canceled: true });

        return res.json({
            success: true,
            fullPath: selectedFullPath,
            fileName: path.basename(selectedFullPath)
        });
    });
});

// 🟢 GET: Buscar automações
app.get('/api/tasks', (req, res) => {
    res.json(readTasksFromFile());
});

// 🟡 POST: Salvar ou Atualizar automação
app.post('/api/tasks', (req, res) => {
    try {
        const newTask = req.body;
        let tasks = readTasksFromFile();
        const index = tasks.findIndex(t => t.id === newTask.id);
        if (index !== -1) {
            tasks[index] = newTask;
        } else {
            tasks.push(newTask);
        }
        fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
        return res.json({ success: true, task: newTask });
    } catch (err) {
        return res.status(500).json({ error: 'Erro ao salvar tarefa' });
    }
});

// 🔴 DELETE: Remover automação
app.delete('/api/tasks/:id', (req, res) => {
    try {
        const { id } = req.params;
        let tasks = readTasksFromFile();
        tasks = tasks.filter(t => t.id !== id);
        fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: 'Erro ao deletar tarefa' });
    }
});

// 📜 GET: Buscar Histórico de Execuções
app.get('/api/history', (req, res) => {
    res.json(readHistoryFromFile());
});

// 📜 DELETE: Limpar todo o Histórico
app.delete('/api/history', (req, res) => {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao limpar histórico' });
    }
});

// ⚡ POST: Executar automação
app.post('/api/tasks/run', (req, res) => {
    const { scriptPath, taskId, taskTitle } = req.body;

    if (!scriptPath) {
        return res.status(400).json({ success: false, error: 'Caminho do script não informado.' });
    }

    let tasks = readTasksFromFile();
    const taskIndex = tasks.findIndex(t => t.id === taskId || t.scriptPath === scriptPath);
    const taskObj = taskIndex !== -1 ? tasks[taskIndex] : null;

    const title = taskTitle || (taskObj ? taskObj.title : 'Execução Manual');
    const fileName = path.basename(scriptPath);

    const fullScriptPath = path.isAbsolute(scriptPath)
        ? scriptPath
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
            taskId: taskId || null,
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

    if (fileExt === '.bat' || fileExt === '.cmd' || fileExt === '.exe') {
        command = `"${fullScriptPath}"`;
        console.log(`▶ Executando EXECUTÁVEL/BATCH: ${fullScriptPath}`);
    } else {
        const pythonExe = ensureVenvEnvironment(scriptDir);

        // Check rápido e inteligente de bibliotecas faltantes
        autoInstallImports(fullScriptPath, pythonExe);

        command = `${pythonExe} "${fullScriptPath}"`;
        console.log(`▶ Executando PYTHON: ${fullScriptPath} usando [${pythonExe}]`);
    }

    // Executa com suporte completo a UTF-8 (Emojis)
    exec(command, {
        cwd: scriptDir,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    }, (error, stdout, stderr) => {
        let errOutput = stderr || (error ? error.message : '');

        if (errOutput.includes('IM002') || errOutput.includes('SQLDriverConnect')) {
            errOutput = `⚠️ ERRO DE SISTEMA: O Driver ODBC do SQL Server não está instalado neste PC.\n\nInstale o 'ODBC Driver 17 for SQL Server' da Microsoft nesta máquina para habilitar a conexão com o Banco de Dados.`;
        }

        let updatedTasks = readTasksFromFile();
        const currentTaskIdx = updatedTasks.findIndex(t => t.id === taskId || t.scriptPath === scriptPath);

        if (error) {
            if (currentTaskIdx !== -1) {
                updatedTasks[currentTaskIdx].status = 'failed';
                fs.writeFileSync(TASKS_FILE, JSON.stringify(updatedTasks, null, 2));
            }

            addHistoryEntry({
                taskId: taskId || null,
                title,
                fileName,
                scriptPath: fullScriptPath,
                status: 'failed',
                output: errOutput
            });

            return res.status(500).json({
                success: false,
                error: errOutput
            });
        }

        if (currentTaskIdx !== -1) {
            updatedTasks[currentTaskIdx].status = 'success';
            fs.writeFileSync(TASKS_FILE, JSON.stringify(updatedTasks, null, 2));
        }

        addHistoryEntry({
            taskId: taskId || null,
            title,
            fileName,
            scriptPath: fullScriptPath,
            status: 'success',
            output: stdout || 'Executado com sucesso.'
        });

        return res.json({
            success: true,
            output: stdout
        });
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:8000`);
    console.log(`📁 Diretório padrão: ${BASE_SCRIPTS_DIR}`);
});