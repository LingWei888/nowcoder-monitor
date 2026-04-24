const { app, BrowserWindow, ipcMain } = require('electron');
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const os = require('os');
const fs = require('fs');
const config = require('./config');

let mainWindow = null;
let server = null;

// 获取本地IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function createMainWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  console.log('Preload path:', preloadPath);
  
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    },
    title: '考试监控服务器'
  });

  mainWindow.loadFile('index.html');
}

function startServer() {
  const expressApp = express();
  const upload = multer();

  // 存储连接的客户端
  const connectedClients = new Map();

  expressApp.use(express.json());

  // 客户端连接
  expressApp.post('/connect', (req, res) => {
    const { clientId } = req.body;
    if (!clientId) {
      return res.status(400).json({ error: 'Client ID required' });
    }

    connectedClients.set(clientId, {
      id: clientId,
      lastSeen: new Date(),
      status: 'online'
    });

    console.log(`Client ${clientId} connected`);
    res.json({ success: true });
  });

  // 客户端心跳
  expressApp.post('/heartbeat', (req, res) => {
    const { clientId } = req.body;
    if (connectedClients.has(clientId)) {
      connectedClients.get(clientId).lastSeen = new Date();
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Client not found' });
    }
  });

  // 创建截图存储目录
  const screenshotsDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // 接收屏幕截图
  expressApp.post('/screenshot', upload.single('image'), (req, res) => {
    const { clientId } = req.body;
    if (!req.file || !clientId) {
      return res.status(400).json({ error: 'Image and client ID required' });
    }

    if (connectedClients.has(clientId)) {
      connectedClients.get(clientId).lastScreenshot = req.file.buffer;
      connectedClients.get(clientId).lastSeen = new Date();

      // 保存截图到文件系统
      const clientDir = path.join(screenshotsDir, clientId);
      if (!fs.existsSync(clientDir)) {
        fs.mkdirSync(clientDir, { recursive: true });
      }
      
      const timestamp = new Date().getTime();
      const filename = `${timestamp}.png`;
      const filepath = path.join(clientDir, filename);
      fs.writeFileSync(filepath, req.file.buffer);

      // 发送到主窗口显示
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('new-screenshot', {
          clientId,
          imageData: req.file.buffer.toString('base64'),
          timestamp: new Date()
        });
      }

      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Client not connected' });
    }
  });

  // 获取连接的客户端列表
  expressApp.get('/clients', (req, res) => {
    const clients = Array.from(connectedClients.values()).map(client => ({
      id: client.id,
      status: client.status,
      lastSeen: client.lastSeen
    }));
    res.json(clients);
  });

  // 获取客户端历史截图列表
  expressApp.get('/screenshots/:clientId', (req, res) => {
    const { clientId } = req.params;
    const clientDir = path.join(screenshotsDir, clientId);
    
    if (!fs.existsSync(clientDir)) {
      return res.json([]);
    }

    const files = fs.readdirSync(clientDir)
      .filter(file => file.endsWith('.png'))
      .map(file => {
        const timestamp = parseInt(file.replace('.png', ''));
        return {
          filename: file,
          timestamp: new Date(timestamp),
          path: `/screenshots/${clientId}/${file}`
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp); // 按时间倒序

    res.json(files);
  });

  // 提供截图文件访问
  expressApp.use('/screenshots', express.static(screenshotsDir));

  const PORT = config.server.port;
  server = expressApp.listen(PORT, config.server.host, () => {
    console.log(`Monitor server running on port ${PORT}`);
    const localIP = getLocalIP();
    console.log(`Local IP: ${localIP}`);

    // 注册到Web端
    registerToWeb(localIP);
  });
}

async function registerToWeb(ip) {
  try {
    await axios.post(`${config.webApi.baseUrl}${config.webApi.endpoints.register}`, {
      ip,
      school: config.monitor.school,
      location: config.monitor.location
    });
    console.log('Registered to web server');

    // 启动心跳
    setInterval(() => {
      axios.post(`${config.webApi.baseUrl}${config.webApi.endpoints.heartbeat}`, { ip })
        .catch(err => console.error('Heartbeat failed:', err.message));
    }, config.heartbeat.interval);
  } catch (error) {
    console.error('Failed to register:', error.message);
  }
}

app.whenReady().then(() => {
  createMainWindow();
  startServer();
});

app.on('window-all-closed', () => {
  if (server) {
    server.close();
  }
  app.quit();
});

ipcMain.handle('get-server-info', () => {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return {
    port: config.server.port,
    ips
  };
});

ipcMain.handle('get-config', () => {
  return config;
});

ipcMain.handle('open-client-detail', (event, clientId) => {
  // 创建详情窗口
  const detailWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    },
    title: `客户端详情 - ${clientId}`
  });

  const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>客户端详情 - ${clientId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Microsoft YaHei', Arial, sans-serif; background: #f0f4f8; color: #333; }
    .header { background: #fff; padding: 20px; border-bottom: 2px solid #e3e8ee; display: flex; justify-content: space-between; align-items: center; }
    .header h2 { color: #4a90e2; }
    .back-btn { padding: 8px 16px; background: #4a90e2; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
    .back-btn:hover { background: #357abd; }
    .container { max-width: 1400px; margin: 20px auto; padding: 0 20px; }
    .screenshots-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
    .screenshot-item { background: #fff; border-radius: 8px; overflow: hidden; border: 2px solid #e3e8ee; cursor: pointer; transition: all 0.2s; }
    .screenshot-item:hover { border-color: #4a90e2; transform: translateY(-2px); }
    .screenshot-item img { width: 100%; height: 200px; object-fit: cover; }
    .screenshot-info { padding: 10px; background: #f8fafc; font-size: 12px; color: #718096; text-align: center; }
    .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 1000; justify-content: center; align-items: center; }
    .modal.active { display: flex; }
    .modal img { max-width: 90%; max-height: 90%; object-fit: contain; }
    .modal-close { position: absolute; top: 20px; right: 30px; color: #fff; font-size: 40px; cursor: pointer; }
    .empty-state { text-align: center; padding: 80px 20px; color: #a0aec0; }
  </style>
</head>
<body>
  <div class="header">
    <h2>客户端 ${clientId} - 历史截图</h2>
    <button class="back-btn" onclick="window.close()">关闭窗口</button>
  </div>
  <div class="container">
    <div id="screenshots-grid" class="screenshots-grid"></div>
    <div id="empty-state" class="empty-state" style="display: none;">
      <h3>暂无截图记录</h3>
    </div>
  </div>
  <div id="modal" class="modal" onclick="closeModal()">
    <span class="modal-close">&times;</span>
    <img id="modal-img" src="" alt="放大截图">
  </div>
  <script>
    const clientId = '${clientId}';
    const gridEl = document.getElementById('screenshots-grid');
    const emptyStateEl = document.getElementById('empty-state');
    const modal = document.getElementById('modal');
    const modalImg = document.getElementById('modal-img');

    fetch('http://localhost:${config.server.port}/screenshots/' + clientId)
      .then(res => res.json())
      .then(screenshots => {
        if (screenshots.length === 0) {
          emptyStateEl.style.display = 'block';
          return;
        }

        screenshots.forEach(ss => {
          const item = document.createElement('div');
          item.className = 'screenshot-item';
          const timeStr = ss.timestamp.toLocaleString('zh-CN');
          item.innerHTML = \`
            <img src="http://localhost:${config.server.port}${ss.path}" onclick="openModal(this.src)">
            <div class="screenshot-info">\${timeStr}</div>
          \`;
          gridEl.appendChild(item);
        });
      })
      .catch(err => console.error('Failed to load screenshots:', err));

    function openModal(src) {
      modalImg.src = src;
      modal.classList.add('active');
    }

    function closeModal() {
      modal.classList.remove('active');
    }
  </script>
</body>
</html>
  `;

  detailWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
});