// 公用 Service Worker for social 项目
const DEFAULT_CONFIG = {
  version: '1.0.0',
  caches: {
    static: 'default-static-v1'
  },
  maxAge: {
    static: 7 * 24 * 60 * 60 * 1000 // 7天
  },
  maxEntries: {
    static: 100
  },
  strategies: {
    static: 'CacheFirst'
  },
  precacheUrls: [],
  excludePatterns: [
    /\/api\//,
    /\?.*nocache/,
    /\/sockjs-node\//,
    /\/hot-update\./
  ]
};

let currentConfig = DEFAULT_CONFIG;
let currentProjectId = 'default';
let configInitialized = false;

// 从当前Service Worker URL中提取项目ID
function extractProjectIdFromClients() {
  return self.clients.matchAll().then(clients => {
    if (clients.length > 0) {
      const clientUrl = new URL(clients[0].url);
      const match = clientUrl.pathname.match(/\/vueiii\/social\/([^\/]+)/);
      return match ? match[1] : 'default';
    }
    return 'default';
  });
}

// 初始化项目配置
function initializeProjectConfig(projectId) {
  currentProjectId = projectId;
  currentConfig = {
    ...DEFAULT_CONFIG,
    caches: {
      static: `${projectId}-static-v1`
    }
  };
  configInitialized = true;
  console.log(`SW initialized for project: ${projectId}`);
}

// 监听广播消息
if ('BroadcastChannel' in self) {
  const channel = new BroadcastChannel('sw-config');
  channel.addEventListener('message', (event) => {
    if (event.data.type === 'CONFIG_UPDATED') {
      if (event.data.projectId && event.data.projectId !== currentProjectId) {
        initializeProjectConfig(event.data.projectId);
      }
      currentConfig = { 
        ...currentConfig, 
        ...event.data.config,
        caches: {
          static: `${currentProjectId}-static-v1`
        }
      };
      console.log(`SW config updated for project: ${currentProjectId}`);
    }
  });
}

// 需要缓存的静态资源类型 - 只缓存JS和CSS
const CACHEABLE_RESOURCES = [
  /\.js$/,
  /\.css$/
];

// 安装事件
self.addEventListener('install', event => {
  console.log('Service Worker installing...');
  event.waitUntil(
    extractProjectIdFromClients().then(projectId => {
      if (!configInitialized) {
        initializeProjectConfig(projectId);
      }
      return caches.open(currentConfig.caches.static);
    }).then(cache => {
      console.log('Precaching core resources');
      return cache.addAll(currentConfig.precacheUrls);
    }).then(() => {
      return self.skipWaiting();
    }).catch(error => {
      console.error('Error during install:', error);
    })
  );
});

// 激活事件
self.addEventListener('activate', event => {
  console.log('Service Worker activating...');
  event.waitUntil(
    extractProjectIdFromClients().then(projectId => {
      if (!configInitialized || projectId !== currentProjectId) {
        initializeProjectConfig(projectId);
      }
      return caches.keys();
    }).then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // 保留当前项目的缓存，删除其他缓存
          if (!cacheName.includes(`${currentProjectId}-`)) {
            console.log('Deleting cache for different project:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// 检查资源是否应该被缓存
function shouldCache(url) {
  return CACHEABLE_RESOURCES.some(pattern => pattern.test(url));
}

// 检查资源是否应该被排除
function shouldExclude(url) {
  return currentConfig.excludePatterns.some(pattern => pattern.test(url));
}

// 网络请求拦截
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理GET请求
  if (request.method !== 'GET') {
    return;
  }

  // 检查是否应该排除
  if (shouldExclude(url.href)) {
    return;
  }

  // 只处理同源请求
  if (url.origin !== location.origin) {
    return;
  }

  // 只缓存JS和CSS文件
  if (shouldCache(url.pathname)) {
    event.respondWith(
      handleRequest(request, currentConfig.strategies.static, currentConfig.caches.static)
    );
  }
});

// 统一的请求处理函数
async function handleRequest(request, strategy, cacheName) {
  return cacheFirst(request, cacheName);
}

// 缓存优先策略
async function cacheFirst(request, cacheName) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse && !isExpired(cachedResponse)) {
      return cachedResponse;
    }

    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      const responseToCache = networkResponse.clone();
      
      const headers = new Headers(responseToCache.headers);
      headers.append('sw-cached-at', Date.now().toString());
      
      const responseWithTimestamp = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers: headers
      });

      // 先清理同名文件的旧版本
      await smartCacheCleanup(cacheName, request);
      
      await cache.put(request, responseWithTimestamp);
      await limitCacheSize(cacheName, currentConfig.maxEntries.static);
    }

    return networkResponse;
  } catch (error) {
    console.error('Fetch failed:', error);
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

// 检查缓存是否过期
function isExpired(response) {
  const cachedAt = response.headers.get('sw-cached-at');
  if (!cachedAt) return false;

  const age = Date.now() - parseInt(cachedAt);
  return age > currentConfig.maxAge.static;
}

// 提取文件基础名（去掉hash）
function getFileBaseName(url) {
  const pathname = new URL(url).pathname;
  const filename = pathname.split('/').pop();
  
  // 匹配模式：name.hash.ext 或 name-hash.ext
  const match = filename.match(/^(.+?)[\.\-]([a-f0-9]{6,})(\.[^.]+)$/i);
  if (match) {
    return match[1] + match[3]; // 返回 name.ext
  }
  return filename;
}

// 智能缓存清理：清理同名文件的旧版本
async function smartCacheCleanup(cacheName, newRequest) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const newBaseName = getFileBaseName(newRequest.url);
  
  // 找到同名文件的旧版本
  const oldVersions = keys.filter(key => {
    const baseName = getFileBaseName(key.url);
    return baseName === newBaseName && key.url !== newRequest.url;
  });
  
  // 删除旧版本
  if (oldVersions.length > 0) {
    console.log(`Cleaning up ${oldVersions.length} old versions of ${newBaseName}`);
    await Promise.all(oldVersions.map(key => cache.delete(key)));
  }
}

// 限制缓存大小（改进版）
async function limitCacheSize(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  
  if (keys.length > maxEntries) {
    // 按缓存时间排序，删除最旧的条目
    const keysWithTime = await Promise.all(
      keys.map(async key => {
        const response = await cache.match(key);
        const cachedAt = response?.headers.get('sw-cached-at') || '0';
        return { key, time: parseInt(cachedAt) };
      })
    );
    
    keysWithTime.sort((a, b) => a.time - b.time);
    const entriesToDelete = keysWithTime.slice(0, keys.length - maxEntries);
    await Promise.all(entriesToDelete.map(item => cache.delete(item.key)));
    
    console.log(`Cleaned up ${entriesToDelete.length} old cache entries`);
  }
}

// 处理消息事件
self.addEventListener('message', event => {
  const { data } = event;

  switch (data.type) {
    case 'CLEAR_CACHE':
      event.waitUntil(
        clearProjectCaches(data.projectId).then(() => {
          event.ports[0].postMessage({ success: true });
        }).catch(error => {
          event.ports[0].postMessage({ success: false, error: error.message });
        })
      );
      break;

    case 'GET_CACHE_SIZE':
      event.waitUntil(
        getCacheSize().then(size => {
          event.ports[0].postMessage({ size });
        })
      );
      break;

    case 'CONFIG_UPDATED':
      if (data.projectId && data.projectId !== currentProjectId) {
        initializeProjectConfig(data.projectId);
      }
      currentConfig = { 
        ...currentConfig, 
        ...data.config,
        caches: {
          static: `${currentProjectId}-static-v1`
        }
      };
      break;

    case 'GET_CACHE_INFO':
      event.waitUntil(
        getCacheInfo().then(info => {
          event.ports[0].postMessage(info);
        })
      );
      break;

    case 'CLEANUP_OLD_VERSIONS':
      event.waitUntil(
        cleanupAllOldVersions().then(() => {
          event.ports[0].postMessage({ success: true });
        }).catch(error => {
          event.ports[0].postMessage({ success: false, error: error.message });
        })
      );
      break;
  }
});

// 清除指定项目的缓存
async function clearProjectCaches(projectId) {
  const targetProjectId = projectId || currentProjectId;
  const cacheNames = await caches.keys();
  const projectCaches = cacheNames.filter(name => 
    name.includes(`${targetProjectId}-`)
  );
  
  await Promise.all(projectCaches.map(name => caches.delete(name)));
  console.log(`Cleared caches for project: ${targetProjectId}`);
}

// 获取缓存大小
async function getCacheSize() {
  const cacheNames = await caches.keys();
  let totalSize = 0;

  for (const cacheName of cacheNames) {
    if (cacheName.includes(`${currentProjectId}-`)) {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      
      for (const request of requests) {
        const response = await cache.match(request);
        if (response) {
          const blob = await response.blob();
          totalSize += blob.size;
        }
      }
    }
  }

  return totalSize;
}

// 获取缓存信息
async function getCacheInfo() {
  const cacheNames = await caches.keys();
  const cacheInfo = {};

  for (const cacheName of cacheNames) {
    if (cacheName.includes(`${currentProjectId}-`)) {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      cacheInfo[cacheName] = {
        count: requests.length,
        urls: requests.map(req => req.url)
      };
    }
  }

  return {
    caches: cacheInfo,
    config: currentConfig,
    projectId: currentProjectId,
    timestamp: Date.now()
  };
}

// 清理所有旧版本文件
async function cleanupAllOldVersions() {
  const cacheNames = await caches.keys();
  let cleanedCount = 0;
  
  for (const cacheName of cacheNames) {
    if (cacheName.includes(`${currentProjectId}-`)) {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      
      // 按基础文件名分组
      const fileGroups = {};
      keys.forEach(key => {
        const baseName = getFileBaseName(key.url);
        if (!fileGroups[baseName]) {
          fileGroups[baseName] = [];
        }
        fileGroups[baseName].push(key);
      });
      
      // 对每组文件，只保留最新的一个
      for (const [baseName, files] of Object.entries(fileGroups)) {
        if (files.length > 1) {
          // 按URL排序，保留最后一个（通常是最新的）
          files.sort((a, b) => a.url.localeCompare(b.url));
          const filesToDelete = files.slice(0, -1);
          
          await Promise.all(filesToDelete.map(key => cache.delete(key)));
          cleanedCount += filesToDelete.length;
          
          console.log(`Cleaned up ${filesToDelete.length} old versions of ${baseName}`);
        }
      }
    }
  }
  
  console.log(`Total cleaned up ${cleanedCount} old version files`);
  return cleanedCount;
}