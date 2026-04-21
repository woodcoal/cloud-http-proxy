# Cloudflare Worker 代理服务

一个功能强大的 Cloudflare Worker 代理服务，支持代理任意 URL、HTML 内容路径处理、请求/响应内容替换、黑白名单控制等功能。

> **⚠️ 免责声明**：本项目仅供学习和技术研究使用，请勿用于任何违法、违规或破坏性用途。使用本项目时，请确保遵守当地法律法规以及目标网站的服务条款。因滥用本项目导致的任何法律责任，由使用者自行承担。

## 功能特性

- **代理转发**：支持代理任意 URL 请求
- **HTML 路径处理**：自动处理 HTML 中的相对路径
- **内容替换**：支持请求/响应体的文本替换，包括 JSON key-value 替换
- **黑白名单**：支持配置允许或禁止访问的地址列表
- **请求限制**：支持请求超时、请求体大小限制、请求方法白名单
- **安全过滤**：自动过滤敏感请求头和 Cloudflare 内部请求头
- **CORS 支持**：支持跨域请求
- **缓存控制**：禁用响应缓存

## 快速开始

### 1. 部署到 Cloudflare Workers

1. 注册 [Cloudflare](https://www.cloudflare.com/) 账号
2. 登录 Cloudflare Dashboard，进入 Workers 页面
3. 点击"创建 Worker"
4. 将 `worker.js` 的内容复制到编辑器中
5. 点击"部署"

### 2. 使用方式

访问代理服务时，在路径中包含目标 URL：

```
https://your-worker.your-subdomain.workers.dev/https://example.com
https://your-worker.your-subdomain.workers.dev/http://api.example.com/users
https://your-worker.your-subdomain.workers.dev/example.com
http://your-worker.your-subdomain.workers.dev/api.example.com/users
```

查询参数会自动保留：

```
https://your-worker.your-subdomain.workers.dev/https://example.com?foo=bar
```

## 配置说明

所有配置都在文件顶部的 `CONFIG` 对象中：

```javascript
const CONFIG = {
	// ==================== 请求相关配置 ====================

	// 请求超时时间（毫秒），设置为 0 表示不限制
	timeout: 0,

	// 请求体大小限制（字节），默认 10MB，设置为 0 表示不限制
	maxRequestBodySize: 10 * 1024 * 1024,

	// 允许的请求方法，设置为空数组表示不限制
	allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH'],

	// ==================== 请求头过滤配置 ====================

	// 要过滤的请求头前缀（这些开头的请求头将被移除）
	// 例如：['cf-'] 会过滤所有 cf- 开头的请求头
	filteredHeaderPrefixes: ['cf-'],

	// 要过滤的敏感请求头（这些请求头将被移除，防止泄露认证信息）
	// 设置为空数组表示不过滤任何敏感请求头
	filteredSensitiveHeaders: [
		'cookie', // Cookie 凭证
		'authorization', // 认证信息（如 Token、Bearer Token）
		'proxy-authorization', // 代理认证信息
		'proxy-authenticate', // 代理认证响应
		'sec-websocket-key', // WebSocket 密钥
		'sec-websocket-protocol' // WebSocket 协议
	],

	// ==================== 访问控制配置 ====================

	// 代理地址黑白名单
	urlAccessControl: {
		mode: 'none', // 'whitelist'（白名单）, 'blacklist'（黑名单）, 'none'（不限制）
		urls: [] // 地址列表
	},

	// ==================== 内容替换配置 ====================

	// 内容替换规则
	replaceRules: [
		// 示例规则
	],

	// ==================== 首页配置 ====================

	// 默认首页（根路径 /）配置
	homePage: {
		statusCode: 200, // 状态码，设置为 null 表示返回空响应
		content: 'Proxy Service Running' // 返回的文本内容
	},

	// ==================== 缓存配置 ====================

	// 是否禁用响应缓存
	disableCache: true
};
```

### 配置详解

#### 请求超时 (timeout)

```javascript
timeout: 30000; // 30秒超时
timeout: 0; // 不限制超时
```

#### 请求体大小限制 (maxRequestBodySize)

```javascript
maxRequestBodySize: 10 * 1024 * 1024; // 10MB
maxRequestBodySize: 5 * 1024 * 1024; // 5MB
maxRequestBodySize: 0; // 不限制
```

#### 请求方法白名单 (allowedMethods)

```javascript
allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH']; // 允许的方法
allowedMethods: ['GET', 'POST']; // 只允许 GET 和 POST
allowedMethods: []; // 不限制
```

#### 请求头过滤 (filteredHeaderPrefixes)

```javascript
filteredHeaderPrefixes: ['cf-']; // 过滤 cf- 开头的请求头（默认）
filteredHeaderPrefixes: ['x-', 'cf-']; // 过滤 x- 和 cf- 开头
filteredHeaderPrefixes: []; // 不过滤
```

#### 敏感请求头过滤 (filteredSensitiveHeaders)

```javascript
// 默认过滤所有敏感请求头（安全）
filteredSensitiveHeaders: [
	'cookie', // Cookie 凭证
	'authorization', // 认证信息（如 Token、Bearer Token）
	'proxy-authorization', // 代理认证信息
	'proxy-authenticate', // 代理认证响应
	'sec-websocket-key', // WebSocket 密钥
	'sec-websocket-protocol' // WebSocket 协议
];

// 不过滤任何敏感请求头
filteredSensitiveHeaders: [];
```

**注意：** 生产环境建议保持默认配置，过滤敏感请求头以防止凭证泄露。

#### 访问控制 (urlAccessControl)

```javascript
// 白名单模式：只有列表中的地址可以访问
urlAccessControl: {
    mode: 'whitelist',
    urls: [
        'example.com',              // 域名匹配
        '*.google.com',             // 通配符匹配所有子域名
        'https://api.test.com',     // 完整 URL
        'https://api.test.com/v1'   // 带路径匹配
    ]
}

// 黑名单模式：列表中的地址禁止访问
urlAccessControl: {
    mode: 'blacklist',
    urls: [
        'malicious.com',
        '*.ads.com'
    ]
}

// 不限制
urlAccessControl: {
    mode: 'none',
    urls: []
}
```

#### 内容替换规则 (replaceRules)

```javascript
replaceRules: [
	// ========== 基础替换 ==========

	// 简单替换（默认）- 替换所有匹配的字符串
	{
		type: 'replace', // 替换方式：'replace'（默认）, 'regex'（正则）, 'exact'（精确）
		pattern: '旧内容', // 要替换的内容
		replacement: '新内容', // 替换后的内容
		direction: 'both' // 作用方向：'request'（请求体）, 'response'（响应体）, 'both'（两者）
	},

	// 精确匹配
	{
		type: 'exact',
		pattern: '完整匹配内容',
		replacement: '替换内容',
		direction: 'request'
	},

	// 正则替换
	{
		type: 'regex',
		pattern: '正则表达式',
		replacement: '替换内容',
		direction: 'response'
	},

	// ========== JSON 替换 ==========

	// 整体替换（默认）- 替换整个 JSON 字符串中的内容
	{
		type: 'replace',
		pattern: 'oldValue',
		replacement: 'newValue',
		direction: 'request',
		jsonMode: 'whole' // 整体替换（默认）
	},

	// key-value 单独替换 - 递归替换 JSON 的 key 和 string 类型的 value
	{
		type: 'replace',
		pattern: 'oldKey',
		replacement: 'newKey',
		direction: 'request',
		jsonMode: 'keyValue' // key-value 模式
	},
	{
		type: 'replace',
		pattern: 'oldValue',
		replacement: 'newValue',
		direction: 'response',
		jsonMode: 'keyValue'
	},

	// 正则 + keyValue 模式
	{
		type: 'regex',
		pattern: '^old',
		replacement: 'new',
		direction: 'both',
		jsonMode: 'keyValue'
	}
];
```

**替换类型说明：**

- `replace`：简单替换，替换所有匹配的字符串
- `exact`：精确匹配，与 replace 效果相同
- `regex`：正则表达式替换

**作用方向说明：**

- `request`：只替换请求体
- `response`：只替换响应体
- `both`：两者都替换

**JSON 模式说明：**

- `whole`（默认）：整体替换，将 JSON 当作普通文本处理
- `keyValue`：递归遍历 JSON 对象，替换所有的 key 和 string 类型的 value

**示例：**

```javascript
// 替换响应中的资源路径
replaceRules: [
	{ type: 'replace', pattern: '/static/', replacement: '/proxy/static/', direction: 'response' }
];

// 移除响应中的广告脚本
replaceRules: [
	{ type: 'regex', pattern: '<script>.*?ads.*?</script>', replacement: '', direction: 'response' }
];

// 替换 JSON 请求中的字段名
replaceRules: [
	{
		type: 'replace',
		pattern: 'old_field_name',
		replacement: 'new_field_name',
		direction: 'request',
		jsonMode: 'keyValue'
	}
];

// 替换 JSON 响应中的值
replaceRules: [
	{
		type: 'replace',
		pattern: 'demo_key',
		replacement: 'production_key',
		direction: 'response',
		jsonMode: 'keyValue'
	}
];
```

#### 首页配置 (homePage)

```javascript
// 返回自定义内容
homePage: {
    statusCode: 200,
    content: 'Proxy Service Running'
}

// 返回 404
homePage: {
    statusCode: 404,
    content: 'Not Found'
}

// 返回空响应
homePage: {
    statusCode: null,
    content: ''
}
```

#### 缓存配置 (disableCache)

```javascript
disableCache: true; // 禁用缓存，每次请求都从源站获取（默认）
disableCache: false; // 允许缓存，由源站响应头控制
```

## 完整配置示例

```javascript
const CONFIG = {
	// 请求超时 30 秒
	timeout: 30000,

	// 请求体最大 5MB
	maxRequestBodySize: 5 * 1024 * 1024,

	// 只允许 GET 和 POST
	allowedMethods: ['GET', 'POST'],

	// 过滤 cf- 和 x- 开头的请求头
	filteredHeaderPrefixes: ['cf-', 'x-'],

	// 过滤敏感请求头（安全配置，默认过滤）
	filteredSensitiveHeaders: ['cookie', 'authorization', 'proxy-authorization'],

	// 白名单模式
	urlAccessControl: {
		mode: 'whitelist',
		urls: ['api.example.com', '*.google.com', 'https://cdn.test.com']
	},

	// 内容替换规则
	replaceRules: [
		// 替换响应中的资源路径
		{
			type: 'replace',
			pattern: '/static/',
			replacement: '/proxy/static/',
			direction: 'response'
		},

		// JSON key-value 替换
		{
			type: 'replace',
			pattern: 'old_key',
			replacement: 'new_key',
			direction: 'request',
			jsonMode: 'keyValue'
		}
	],

	// 首页配置
	homePage: {
		statusCode: 200,
		content: 'Proxy Service Running'
	},

	// 禁用缓存
	disableCache: true
};
```

## 注意事项

1. **Cloudflare Workers 限制**：Cloudflare Workers 有 CPU 时间限制（通常 10ms-50ms），处理大量内容时注意性能
2. **请求体消耗**：读取请求体后会被消耗，务必在正确顺序处理
3. **JSON 替换**：使用 `jsonMode: 'keyValue'` 时，请确保替换不会破坏 JSON 结构
4. **安全性**：建议生产环境启用黑白名单，限制可访问的地址
5. **CORS**：默认允许所有跨域请求，生产环境建议根据需要限制

## 常见问题

### Q: 如何代理带认证的网站？

代理服务会过滤掉 `Cookie` 和 `Authorization` 等敏感请求头，如需保留请修改 `filteredSensitiveHeaders` 参数数组。

### Q: 为什么有些网站无法代理？

部分网站有反爬虫机制或仅允许特定域名访问，这种情况下可能无法代理。

### Q: 如何处理 HTTPS 证书问题？

Cloudflare Workers 自动处理 HTTPS 证书，不需要额外配置。

### Q: 如何查看访问日志？

Cloudflare Workers 有内置的日志功能，在 Cloudflare Dashboard 的 Workers 页面可以查看。

## 许可证

MIT License
