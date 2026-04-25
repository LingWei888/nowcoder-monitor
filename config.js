// 应用配置文件
const config = {
  // 服务器配置
  server: {
    port: 3000,
    host: '0.0.0.0'
  },

  // Web API 配置
  webApi: {
    baseUrl: 'http://api-acnowcoder.exitcode.cn',
    endpoints: {
      register: '/monitors',
      heartbeat: '/heartbeat'
    }
  },

  // 监控器信息
  monitor: {
    school: '河北科技大学',
    location: '河北科技大学信澳联大C109-'
  },

  // 心跳配置
  heartbeat: {
    interval: 10000 // 每10秒发送一次心跳
  },

  // 截图配置
  screenshot: {
    maxDisplayCount: 10 // 最多显示的截图数量
  },

  // 客户端列表刷新配置
  clientList: {
    refreshInterval: 5000 // 每5秒刷新一次客户端列表
  },

  // 比赛信息配置
  exam: {
    examUrl: 'https://ac.nowcoder.com/acm/contest/12345',
    password: 'ABC123',
    examTitle: '2024春季程序设计竞赛',
    startTime: '2024-04-24T14:00:00Z',
    endTime: '2024-04-24T17:00:00Z'
  }

  // 如需切换比赛，修改以上配置即可
  // 截图会自动存储到 screenshots/{比赛名称}/ 目录下
};

module.exports = config;
