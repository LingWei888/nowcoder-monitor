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

  // 存储连接的客户端（按学号分组）
  const connectedClients = new Map();
  const ipToClientMap = new Map(); // IP -> clientId 映射

  // 离线检测：每30秒检查一次，超过60秒无心跳视为离线
  setInterval(() => {
    const now = Date.now();
    const timeout = 60000; // 60秒超时

    connectedClients.forEach((client, clientId) => {
      const lastSeenTime = new Date(client.lastSeen).getTime();
      if (now - lastSeenTime > timeout && client.status === 'online') {
        client.status = 'offline';
        console.log(`考生 ${client.name || clientId} (${clientId}) 已离线`);
      }
    });

    // 通知主窗口更新
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clients-updated');
    }
  }, 30000);

  expressApp.use(express.json());

  // 添加CORS支持
  expressApp.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // 客户端连接
  expressApp.post('/connect', (req, res) => {
    const { clientId, name, nickname, ip } = req.body;
    if (!clientId) {
      return res.status(400).json({ success: false, message: '学号不能为空' });
    }

    // 如果该IP已有客户端，删除旧记录
    if (ip && ipToClientMap.has(ip)) {
      const oldClientId = ipToClientMap.get(ip);
      if (oldClientId !== clientId && connectedClients.has(oldClientId)) {
        console.log(`IP ${ip} 从 ${oldClientId} 切换到 ${clientId}`);
        connectedClients.delete(oldClientId);
      }
    }

    // 记录IP映射
    if (ip) {
      ipToClientMap.set(ip, clientId);
    }

    // 如果学号已存在，更新信息；否则创建新记录
    if (connectedClients.has(clientId)) {
      const client = connectedClients.get(clientId);
      client.name = name || client.name;
      client.nickname = nickname || client.nickname;
      client.ip = ip || client.ip;
      client.lastSeen = new Date();
      client.status = 'online';
      console.log(`考生 ${name || clientId} (${clientId}) 重新连接`);
    } else {
      connectedClients.set(clientId, {
        id: clientId,
        name: name || '',
        nickname: nickname || '',
        ip: ip || 'unknown',
        lastSeen: new Date(),
        status: 'online'
      });
      console.log(`考生 ${name || clientId} (${clientId}) 首次连接，IP: ${ip || 'unknown'}`);
    }

    res.json({ success: true, message: '连接成功' });
  });

  // 客户端心跳
  expressApp.post('/heartbeat', (req, res) => {
    const { clientId, ip } = req.body;
    if (connectedClients.has(clientId)) {
      const client = connectedClients.get(clientId);
      client.lastSeen = new Date();
      // 更新IP信息
      if (ip) {
        client.ip = ip;
        ipToClientMap.set(ip, clientId);
      }
      res.json({ success: true, timestamp: Date.now() });
    } else {
      res.status(404).json({ success: false, message: '考生未找到' });
    }
  });

  // 获取比赛信息
  expressApp.post('/get-exam-info', (req, res) => {
    const { clientId, name, nickname } = req.body;

    if (!clientId) {
      return res.status(400).json({ success: false, message: '学号不能为空' });
    }

    // 如果考生未连接，先自动注册
    if (!connectedClients.has(clientId)) {
      connectedClients.set(clientId, {
        id: clientId,
        name: name || '',
        nickname: nickname || '',
        ip: 'unknown',
        lastSeen: new Date(),
        status: 'online'
      });
      console.log(`考生 ${name || clientId} (${clientId}) 通过获取比赛信息接口自动注册`);
    }

    res.json({
      success: true,
      examUrl: config.exam.examUrl,
      password: config.exam.password,
      examTitle: config.exam.examTitle,
      startTime: config.exam.startTime,
      endTime: config.exam.endTime
    });
  });

  // 创建截图存储目录（按比赛分类）
  const examId = config.exam.examTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
  const screenshotsDir = path.join(__dirname, 'screenshots', examId);
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
  console.log(`截图存储目录: ${screenshotsDir}`);

  // 接收屏幕截图
  expressApp.post('/screenshot', upload.single('image'), (req, res) => {
    const { clientId } = req.body;
    if (!req.file || !clientId) {
      return res.status(400).json({ success: false, message: '图片和学号不能为空' });
    }

    if (!connectedClients.has(clientId)) {
      return res.status(404).json({ success: false, message: '考生未连接' });
    }

    const client = connectedClients.get(clientId);
    client.lastScreenshot = req.file.buffer;
    client.lastSeen = new Date();

    // 保存截图到文件系统
    const clientDir = path.join(screenshotsDir, clientId);
    if (!fs.existsSync(clientDir)) {
      fs.mkdirSync(clientDir, { recursive: true });
    }

    const timestamp = new Date().getTime();
    const filename = `${clientId}_${timestamp}.png`;
    const filepath = path.join(clientDir, filename);
    fs.writeFileSync(filepath, req.file.buffer);

    // 发送到主窗口显示
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('new-screenshot', {
        clientId,
        studentName: client.name,
        nickname: client.nickname,
        imageData: req.file.buffer.toString('base64'),
        timestamp: new Date()
      });
    }

    console.log(`收到考生 ${client.name || clientId} 的截图`);
    res.json({ success: true, savedPath: `/screenshots/${examId}/${clientId}/${filename}` });
  });

  // 获取连接的客户端列表（已按学号去重）
  expressApp.get('/clients', (req, res) => {
    const clients = Array.from(connectedClients.values()).map(client => ({
      id: client.id,
      name: client.name,
      nickname: client.nickname,
      ip: client.ip,
      status: client.status,
      lastSeen: client.lastSeen
    }));
    res.json(clients);
  });

  // 获取客户端历史截图列表
  expressApp.get('/screenshots/:clientId', (req, res) => {
    const { clientId } = req.params;
    const clientDir = path.join(screenshotsDir, clientId);

    console.log(`请求截图列表: clientId=${clientId}, 目录=${clientDir}`);
    console.log(`目录是否存在: ${fs.existsSync(clientDir)}`);

    if (!fs.existsSync(clientDir)) {
      console.log('目录不存在，返回空数组');
      return res.json([]);
    }

    const files = fs.readdirSync(clientDir)
      .filter(file => file.endsWith('.png'));

    console.log(`找到 ${files.length} 个截图文件:`, files);

    const screenshots = files.map(file => {
      // 文件名格式: clientId_timestamp.png
      const parts = file.replace('.png', '').split('_');
      const timestamp = parseInt(parts[parts.length - 1]);
      console.log(`文件: ${file}, 解析时间戳: ${timestamp}`);
      return {
        filename: file,
        timestamp: new Date(timestamp),
        path: `/screenshots/${examId}/${clientId}/${file}`
      };
    }).sort((a, b) => b.timestamp - a.timestamp); // 按时间倒序

    console.log(`返回 ${screenshots.length} 条记录`);
    if (screenshots.length > 0) {
      console.log('第一条记录:', screenshots[0]);
    }
    res.json(screenshots);
  });

  // 提供截图文件访问
  expressApp.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));

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

  // 自动打开开发者工具
  //detailWindow.webContents.openDevTools();

  const examId = config.exam.examTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
  const serverPort = config.server.port;

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

    console.log('开始加载截图，clientId:', clientId);
    console.log('API地址:', 'http://localhost:${serverPort}/screenshots/' + clientId);
    
    fetch('http://localhost:${serverPort}/screenshots/' + clientId)
      .then(res => {
        console.log('API响应状态:', res.status);
        return res.json();
      })
      .then(screenshots => {
        console.log('获取到截图数据:', screenshots);
        console.log('截图数量:', screenshots.length);
        
        if (screenshots.length === 0) {
          emptyStateEl.style.display = 'block';
          return;
        }

        screenshots.forEach(screenshot => {
          const item = document.createElement('div');
          item.className = 'screenshot-item';
          const timeStr = screenshot.timestamp.toLocaleString('zh-CN');
          const imgUrl = 'http://localhost:${serverPort}' + screenshot.path;
          console.log('图片URL:', imgUrl);
          item.innerHTML = '<img src="' + imgUrl + '" onclick="openModal(this.src)"><div class="screenshot-info">' + timeStr + '</div>';
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
