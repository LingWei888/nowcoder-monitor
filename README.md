# 考试监控系统

## 项目简介

基于 Electron + Express 的考试监控桌面应用，支持实时监控多个客户端屏幕截图。

## 技术栈

- **Electron**: 桌面应用框架
- **Express**: HTTP 服务器
- **Multer**: 文件上传处理
- **Axios**: HTTP 请求

## 快速开始

### 安装依赖

```bash
npm install
```

### 安装 cloudflared (内网穿透)

**Windows:**
```bash
winget install cloudflare.cloudflared
```

**macOS:**
```bash
brew install cloudflared
```

**Linux:**
```bash
# 参考官网: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

### 启动应用

```bash
npm start
```

或开发模式：

```bash
npm run dev
```

### 打包应用

```bash
npm run build:win
```

## 功能特性

### 1. 内网穿透 (cloudflared)
- 启动时自动开启内网穿透
- 生成公网访问地址 (https://xxx.trycloudflare.com)
- 在 config.js 中配置 `tunnel.enabled` 启用/禁用
- 控制台和前端会显示公网 URL

### 2. 考生登录系统
- 独立的登录页面 (`client-login.html`)
- 填写学号、姓名、网名
- 选择监考服务器地址
- 自动获取比赛链接和密码
- 自动跳转至比赛页面

### 3. 实时监控
- 座位式网格布局展示所有客户端
- 在线/离线状态实时显示
- 最新截图实时预览

### 4. 历史截图查看
- 点击任意客户端卡片打开详情窗口
- 查看该客户端的所有历史截图
- 支持点击放大查看截图

### 5. 截图存储

**存储位置：** `项目根目录/screenshots/`

**目录结构：**
```
monitor/
├── screenshots/          # 截图根目录
│   ├── client001/       # 客户端ID目录
│   │   ├── 1714025600000.png
│   │   ├── 1714025660000.png
│   │   └── ...
│   ├── client002/
│   │   └── ...
│   └── ...
```

**文件命名规则：** 时间戳.png（例如：1714025600000.png）

### 6. API 接口

#### 考生端接口

- `POST /connect` - 考生连接注册
  ```json
  {
    "clientId": "2021001234",
    "name": "张三",
    "nickname": "代码小王子"
  }
  ```

- `POST /get-exam-info` - 获取比赛信息
  ```json
  响应:
  {
    "success": true,
    "examUrl": "https://ac.nowcoder.com/acm/contest/12345",
    "password": "ABC123",
    "examTitle": "2024春季程序设计竞赛",
    "startTime": "2024-04-24T14:00:00Z",
    "endTime": "2024-04-24T17:00:00Z"
  }
  ```

- `POST /heartbeat` - 心跳保持（每10秒）
- `POST /screenshot` - 上传截图（每30秒）

#### 服务端接口

- `POST /connect` - 客户端连接
- `POST /heartbeat` - 心跳保持
- `POST /screenshot` - 上传截图

#### 服务端接口

- `GET /clients` - 获取客户端列表
- `GET /screenshots/:clientId` - 获取客户端历史截图列表
- `GET /screenshots/:clientId/:filename` - 访问具体截图文件

## 配置说明

编辑 `config.js` 文件修改配置：

```javascript
{
  server: {
    port: 3000,           // 服务器端口
    host: '0.0.0.0'      // 监听地址
  },
  webApi: {
    baseUrl: 'http://api-acnowcoder.exitcode.cn',
    endpoints: {
      register: '/monitors',
      heartbeat: '/heartbeat'
    }
  },
  monitor: {
    school: '河北科技大学',
    location: '河北科技大学信澳联大C109'
  },
  heartbeat: {
    interval: 10000       // 心跳间隔（毫秒）
  },
  tunnel: {
    enabled: true,        // 是否启用内网穿透
    port: 3000           // 要穿透的本地端口
  }
}
```

## 使用说明

### 监考端使用

1. **启动监控服务器**
   - 运行 `npm start`
   - 主窗口显示所有连接的考男

2. **查看实时状态**
   - 蓝色边框 = 在线
   - 灰色边框 = 离线
   - 卡片中显示考生姓名、网名、IP和最新截图

3. **查看历史截图**
   - 点击任意考生卡片
   - 弹出详情窗口显示所有历史截图
   - 点击截图可放大查看

### 考生端使用

1. **打开登录页面**
   - 在浏览器中打开 `client-login.html`

2. **填写信息**
   - 输入监考服务器地址（例如: http://192.168.1.100:3000）
   - 输入学号、姓名、网名

3. **进入考试**
   - 点击“进入考试”按钮
   - 系统自动连接服务器并获取比赛信息
   - 自动跳转到比赛页面

4. **后台运行**
   - 登录页面会在后台维持心跳
   - 每30秒自动上传截图（需要客户端实现）

4. **截图文件管理**
   - 所有截图保存在 `screenshots` 文件夹
   - 按客户端ID分目录存储
   - 文件名使用时间戳，可按时间排序

## 注意事项

- 截图会自动保存到本地文件系统
- 建议定期清理旧的截图文件以节省空间
- 确保防火墙允许相应端口的网络访问
