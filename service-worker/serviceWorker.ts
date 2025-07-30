// Service Worker 注册和管理工具
import { getCacheConfig } from './cacheConfig'

export interface ServiceWorkerManager {
  register: (scope?: string) => Promise<ServiceWorkerRegistration | null>;
  unregister: () => Promise<boolean>;
  update: () => Promise<void>;
  clearCache: () => Promise<boolean>;
  getCacheSize: () => Promise<number>;
  cleanupOldVersions: () => Promise<boolean>;
}

class SWManager implements ServiceWorkerManager {
  private registration: ServiceWorkerRegistration | null = null
  private currentScope = '/'

  /**
   * 注册 Service Worker
   */
  async register(scope = '/'): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) {
      console.warn('Service Worker not supported')
      return null
    }

    this.currentScope = scope

    try {
      // 使用相对于当前模块的路径来定位 sw.js
      const swPath = new URL('./sw.js', import.meta.url).href
      this.registration = await navigator.serviceWorker.register(swPath, {
        scope
      })

      console.log('Service Worker registered successfully:', this.registration)

      // 获取项目标识并发送缓存配置
      const projectId = this.getProjectIdFromScope()
      const cacheConfig = getCacheConfig(projectId)

      // 立即尝试发送配置，如果失败则等待激活
      this.sendConfigToServiceWorker(cacheConfig, projectId)

      // 监听控制器变化，确保配置发送成功
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        this.sendConfigToServiceWorker(cacheConfig, projectId)
      })

      // 监听更新
      this.registration.addEventListener('updatefound', () => {
        const newWorker = this.registration?.installing
        if (newWorker) {
          console.log('New Service Worker installing...')
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('New Service Worker installed, reload to activate')
              // 可以在这里通知用户刷新页面
              this.notifyUpdate()
            }
          })
        }
      })

      return this.registration
    } catch (error) {
      console.error('Service Worker registration failed:', error)
      return null
    }
  }

  /**
   * 卸载 Service Worker
   */
  async unregister(): Promise<boolean> {
    if (!this.registration) {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration) {
        this.registration = registration
      }
    }

    if (this.registration) {
      const result = await this.registration.unregister()
      console.log('Service Worker unregistered:', result)
      return result
    }

    return false
  }

  /**
   * 更新 Service Worker
   */
  async update(): Promise<void> {
    if (this.registration) {
      await this.registration.update()
      console.log('Service Worker update triggered')
    }
  }

  /**
   * 清除所有缓存
   */
  async clearCache(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!navigator.serviceWorker.controller) {
        resolve(false)
        return
      }

      const messageChannel = new MessageChannel()
      messageChannel.port1.onmessage = (event) => {
        resolve(event.data.success || false)
      }

      // 从当前作用域提取项目标识
      const projectId = this.getProjectIdFromScope()

      navigator.serviceWorker.controller.postMessage(
        { type: 'CLEAR_CACHE', projectId },
        [messageChannel.port2]
      )
    })
  }

  /**
   * 获取缓存大小
   */
  async getCacheSize(): Promise<number> {
    return new Promise((resolve) => {
      if (!navigator.serviceWorker.controller) {
        resolve(0)
        return
      }

      const messageChannel = new MessageChannel()
      messageChannel.port1.onmessage = (event) => {
        resolve(event.data.size || 0)
      }

      navigator.serviceWorker.controller.postMessage(
        { type: 'GET_CACHE_SIZE' },
        [messageChannel.port2]
      )
    })
  }

  /**
   * 发送配置到 Service Worker
   */
  private sendConfigToServiceWorker(config: any, projectId: string): void {
    const message = {
      type: 'CONFIG_UPDATED',
      config,
      projectId
    }

    // 尝试发送给当前控制器
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(message)
    }

    // 发送给所有注册的 Service Worker
    if (this.registration) {
      // 发送给激活的
      if (this.registration.active) {
        this.registration.active.postMessage(message)
      }

      // 发送给安装中的
      if (this.registration.installing) {
        this.registration.installing.postMessage(message)
      }

      // 发送给等待中的
      if (this.registration.waiting) {
        this.registration.waiting.postMessage(message)
      }
    }

    // 使用 broadcast 也发送一次
    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel('sw-config')
      channel.postMessage(message)
      channel.close()
    }
  }

  /**
   * 从作用域提取项目标识
   */
  private getProjectIdFromScope(): string {
    // 从当前页面URL中提取项目名称
    const currentPath = window.location.pathname
    // 匹配 /vueiii/social/项目名/ 格式
    const match = currentPath.match(/\/vueiii\/social\/([^\/]+)/)
    return match ? match[1] : 'default'
  }

  /**
   * 通知用户有更新
   */
  private notifyUpdate() {
    console.log('App update available! Please refresh the page.')
    // 自动刷新页面获取最新版本
    setTimeout(() => {
      if (confirm('A new version is available. Refresh now?')) {
        window.location.reload()
      }
    }, 1000)
  }

  /**
   * 强制更新并刷新
   */
  async forceUpdate(): Promise<void> {
    try {
      // 1. 清除所有缓存
      await this.clearCache()

      // 2. 更新Service Worker
      await this.update()

      // 3. 刷新页面
      setTimeout(() => {
        window.location.reload()
      }, 1000)

      console.log('强制更新完成')
    } catch (error) {
      console.error('强制更新失败:', error)
    }
  }

  /**
   * 清理旧版本文件
   */
  async cleanupOldVersions(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!navigator.serviceWorker.controller) {
        resolve(false)
        return
      }

      const messageChannel = new MessageChannel()
      messageChannel.port1.onmessage = (event) => {
        resolve(event.data.success || false)
      }

      navigator.serviceWorker.controller.postMessage(
        { type: 'CLEANUP_OLD_VERSIONS' },
        [messageChannel.port2]
      )
    })
  }

  /**
   * 检查是否有更新
   */
  async checkForUpdates(): Promise<boolean> {
    if (!this.registration) {
      return false
    }

    try {
      await this.registration.update()
      return this.registration?.waiting !== null
    } catch (error) {
      console.error('检查更新失败:', error)
      return false
    }
  }
}

// 创建全局实例
export const swManager = new SWManager()

// 格式化缓存大小
export function formatCacheSize(bytes: number): string {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / k ** i).toFixed(2)) + ' ' + sizes[i]
}

// 检查Service Worker支持
export function isServiceWorkerSupported(): boolean {
  return 'serviceWorker' in navigator
}
