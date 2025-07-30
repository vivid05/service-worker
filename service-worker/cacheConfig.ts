// Service Worker 缓存配置
export interface CacheConfig {
  version: string;
  caches: {
    static: string;
  };
  maxAge: {
    static: number; // 静态资源缓存时间（毫秒）
  };
  maxEntries: {
    static: number; // 静态资源最大缓存条目数
  };
  strategies: {
    static: 'CacheFirst' | 'NetworkFirst' | 'StaleWhileRevalidate';
  };
  precacheUrls: string[];
  excludePatterns: RegExp[];
}

// 默认缓存配置（使用通用配置，缓存名称通过函数生成）
export const defaultCacheConfig: Omit<CacheConfig, 'caches'> = {
  version: '1.0.0',
  maxAge: {
    static: 7 * 24 * 60 * 60 * 1000 // 7天
  },
  maxEntries: {
    static: 100
  },
  strategies: {
    static: 'CacheFirst' // 静态资源优先使用缓存
  },
  precacheUrls: [
    // 不预缓存任何资源，JS/CSS按需缓存
  ],
  excludePatterns: [
    /\/api\//, // 排除API请求
    /\?.*nocache/, // 排除带nocache参数的请求
    /\/sockjs-node\//, // 排除开发服务器WebSocket
    /\/hot-update\./, // 排除热更新文件
    /\.(png|jpg|jpeg|gif|webp|svg|ico)$/, // 排除图片文件
    /\.(woff|woff2|ttf|eot)$/, // 排除字体文件
    /\.html$/ // 排除HTML文件
  ]
}

// 创建特定项目的缓存配置
export function createProjectCacheConfig(projectId: string): CacheConfig {
  return {
    ...defaultCacheConfig,
    caches: {
      static: generateCacheKey('static', defaultCacheConfig.version, projectId)
    }
  }
}

// 获取当前配置（可以从localStorage或配置文件读取）
export function getCacheConfig(projectId = 'default'): CacheConfig {
  try {
    const storedConfig = localStorage.getItem(`sw-cache-config-${projectId}`)
    if (storedConfig) {
      const parsed = JSON.parse(storedConfig)
      const baseConfig = createProjectCacheConfig(projectId)
      return { ...baseConfig, ...parsed }
    }
  } catch (error) {
    console.warn('Failed to load cache config from localStorage:', error)
  }

  return createProjectCacheConfig(projectId)
}

// 更新缓存配置
export function updateCacheConfig(newConfig: Partial<CacheConfig>, projectId = 'default'): void {
  try {
    const currentConfig = getCacheConfig(projectId)
    const updatedConfig = { ...currentConfig, ...newConfig }
    localStorage.setItem(`sw-cache-config-${projectId}`, JSON.stringify(updatedConfig))

    // 通知Service Worker配置已更新
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'CONFIG_UPDATED',
        config: updatedConfig,
        projectId
      })
    }
  } catch (error) {
    console.error('Failed to update cache config:', error)
  }
}

// 重置为默认配置
export function resetCacheConfig(projectId = 'default'): void {
  try {
    localStorage.removeItem(`sw-cache-config-${projectId}`)

    const defaultConfig = createProjectCacheConfig(projectId)
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'CONFIG_UPDATED',
        config: defaultConfig,
        projectId
      })
    }
  } catch (error) {
    console.error('Failed to reset cache config:', error)
  }
}

// 检查资源是否应该被排除
export function shouldExclude(url: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(url))
}

// 生成缓存键名
export function generateCacheKey(type: 'static', version: string, projectId = 'default'): string {
  return `${projectId}-${type}-${version}`
}
