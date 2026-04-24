const { app, BrowserWindow, ipcMain } = require('electron');
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const os = require('os');

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
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: '考试监控服务器'
  });

  mainWindow.loadFile('index.html');

  // 开发时打开开发者工具
  // mainWindow.webContents.openDevTools();
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

  // 接收屏幕截图
  expressApp.post('/screenshot', upload.single('image'), (req, res) => {
    const { clientId } = req.body;
    if (!req.file || !clientId) {
      return res.status(400).json({ error: 'Image and client ID required' });
    }

    if (connectedClients.has(clientId)) {
      connectedClients.get(clientId).lastScreenshot = req.file.buffer;
      connectedClients.get(clientId).lastSeen = new Date();

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

  const PORT = 3000;
  server = expressApp.listen(PORT, '0.0.0.0', () => {
    console.log(`Monitor server running on port ${PORT}`);
    const localIP = getLocalIP();
    console.log(`Local IP: ${localIP}`);

    // 注册到Web端
    registerToWeb(localIP);
  });
}

async function registerToWeb(ip) {
  try {
    await axios.post('http://api-acnowcoder.exitcode.cn/api.php/monitors', {
      ip,
      school: '默认学校', // 可以从配置获取
      location: '默认地点'
    });
    console.log('Registered to web server');

    // 启动心跳
    setInterval(() => {
      axios.post('http://api-acnowcoder.exitcode.cn/api.php/heartbeat', { ip })
        .catch(err => console.error('Heartbeat failed:', err.message));
    }, 10000); // 每10秒心跳
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
    port: 3000,
    ips
  };
});