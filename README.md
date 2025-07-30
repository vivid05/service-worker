# Service Worker 缓存管理系统

一个智能的 Service Worker 解决方案，专为多项目共享和资源缓存优化而设计。

## 特性

### 🚀 核心功能
- **多项目缓存隔离**：每个项目拥有独立的缓存空间
- **智能缓存策略**：只缓存 JS 和 CSS 文件，避免不必要的资源缓存
- **自动版本管理**：自动识别并清理过期的文件版本
- **配置热更新**：支持运行时动态更新缓存配置

### 🧹 智能清理
- **自动清理**：当缓存新文件时，自动删除同名文件的旧版本
- **版本识别**：智能识别 `index.abc123.js` 和 `index.def456.js` 为同一文件的不同版本
- **手动清理**：提供 API 主动清理所有旧版本文件
- **缓存限制**：按时间戳智能管理缓存条目数量

## 快速开始

### 1. 引入文件

```javascript
import { swManager } from './serviceWorker.js'
```

### 2. 注册 Service Worker

```javascript
// 基本注册
const registration = await swManager.register()

// 指定作用域
const registration = await swManager.register('/my-app/')
```

### 3. 管理缓存

```javascript
// 获取缓存大小
const size = await swManager.getCacheSize()
console.log(`缓存大小: ${size} 字节`)

// 清理旧版本文件
const success = await swManager.cleanupOldVersions()
console.log(`清理${success ? '成功' : '失败'}`)

// 清空所有缓存
const cleared = await swManager.clearCache()
```

## 文件结构

```
service-worker/
├── serviceWorker.ts    # Service Worker 管理类
├── cacheConfig.ts      # 缓存配置管理
├── sw.js              # Service Worker 实现
└── README.md          # 项目文档
```

## API 文档

### ServiceWorkerManager

#### `register(scope?: string): Promise<ServiceWorkerRegistration | null>`
注册 Service Worker
- `scope`: 可选，Service Worker 的作用域，默认为 '/'

#### `unregister(): Promise<boolean>`
卸载 Service Worker

#### `update(): Promise<void>`
手动触发 Service Worker 更新

#### `clearCache(): Promise<boolean>`
清空当前项目的所有缓存

#### `getCacheSize(): Promise<number>`
获取当前项目的缓存大小（字节）

#### `cleanupOldVersions(): Promise<boolean>`
清理所有旧版本文件，只保留每个文件的最新版本

#### `forceUpdate(): Promise<void>`
强制更新：清理缓存 → 更新 SW → 刷新页面

#### `checkForUpdates(): Promise<boolean>`
检查是否有可用更新

## 配置管理

### 默认配置

```javascript
{
  version: '1.0.0',
  maxAge: {
    static: 7 * 24 * 60 * 60 * 1000 // 7天
  },
  maxEntries: {
    static: 100 // 最多缓存100个文件
  },
  strategies: {
    static: 'CacheFirst' // 缓存优先策略
  },
  excludePatterns: [
    /\/api\//,           // API请求
    /\?.*nocache/,       // 带nocache参数
    /\/sockjs-node\//,   // 开发服务器
    /\/hot-update\./,    // 热更新文件
    /\.(png|jpg|jpeg|gif|webp|svg|ico)$/, // 图片
    /\.(woff|woff2|ttf|eot)$/,           // 字体
    /\.html$/            // HTML文件
  ]
}
```

### 自定义配置

```javascript
import { updateCacheConfig } from './cacheConfig.js'

// 更新配置
updateCacheConfig({
  maxEntries: { static: 200 },
  maxAge: { static: 14 * 24 * 60 * 60 * 1000 } // 14天
}, 'my-project')

// 重置为默认配置
resetCacheConfig('my-project')
```

## 工作原理

### 项目识别
Service Worker 通过 URL 路径自动识别项目：
```
https://example.com/vueiii/social/project-a/ → 项目ID: project-a
https://example.com/vueiii/social/project-b/ → 项目ID: project-b
```

### 缓存命名
每个项目使用独立的缓存命名空间：
```
project-a-static-v1
project-b-static-v1
```

### 智能版本管理
系统能识别这些文件为同一文件的不同版本：
- `index.abc123.js` → 基础名: `index.js`
- `index.def456.js` → 基础名: `index.js`
- `main-hash123.css` → 基础名: `main.css`

当缓存新版本时，旧版本会被自动删除。

## 使用场景

### 开发环境
```javascript
// 注册时启用开发模式
if (process.env.NODE_ENV === 'development') {
  // 开发环境可能需要更频繁的更新检查
  setInterval(() => {
    swManager.checkForUpdates()
  }, 30000) // 30秒检查一次
}
```

### 生产环境
```javascript
// 生产环境自动注册
if (process.env.NODE_ENV === 'production') {
  swManager.register().then(registration => {
    if (registration) {
      console.log('Service Worker 注册成功')
    }
  })
}
```

### 版本更新通知
```javascript
// 监听更新事件
navigator.serviceWorker.addEventListener('controllerchange', () => {
  console.log('新版本已激活')
  // 可以显示通知给用户
})
```

## 最佳实践

1. **定期清理**：建议定期调用 `cleanupOldVersions()` 清理旧版本文件
2. **缓存监控**：定期检查缓存大小，避免占用过多存储空间
3. **错误处理**：始终为 Service Worker 操作添加错误处理
4. **用户体验**：在更新时给用户适当的提示

## 兼容性

- 支持所有现代浏览器的 Service Worker API
- 自动检测 Service Worker 支持情况
- 在不支持的环境中优雅降级

## 注意事项

- Service Worker 只在 HTTPS 或 localhost 环境下工作
- 缓存清理操作是异步的，可能需要一些时间完成
- 项目ID提取依赖特定的URL格式，如需要可自定义路径匹配规则