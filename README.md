# Cloudflare Worker 代理服务

一个功能强大的代理服务，提供 Cloudflare Worker 和 .NET 两种实现方式，支持代理任意 URL、HTML 内容路径处理、请求/响应内容替换、黑白名单控制等功能。

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

## 项目结构

```
├── worker.js   # Cloudflare Worker 主代理逻辑（包含配置）
├── .net/       # .NET 实现版本
│   ├── CloudHttpProxy.csproj     # .NET 项目文件
│   ├── Program.cs                # 应用入口
│   ├── ProxyConfig.cs            # 配置类
│   ├── ProxyMiddleware.cs        # 核心代理中间件
│   ├── Utils.cs                  # 工具类
│   └── appsettings.json          # 配置文件
└── README.md   # 说明文档
```

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

	// 快捷地址映射
	urlShortcuts: {},

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

	// ==================== 认证配置 ====================

	// 代理访问密钥
	proxyToken: '',

	// IP 白名单
	ipWhitelist: [],

	// ==================== HTML 路径配置 ====================

	// HTML 路径替换范围（数组形式，可组合）
	htmlPathRewriteScope: ['link', 'style', 'script', 'image', 'media', 'iframe', 'form'],

	// ==================== 缓存配置 ====================

	// 是否禁用响应缓存
	disableCache: true
};
```

### 配置详解

#### 请求超时 (timeout / Timeout)

- **Cloudflare Worker 版本：**

    ```javascript
    timeout: 30000; // 30秒超时
    timeout: 0; // 不限制超时
    ```

- **.NET 版本：**
    ```json
    "Timeout": 30000, // 30秒超时
    "Timeout": 0 // 不限制超时
    ```

#### 请求体大小限制 (maxRequestBodySize / MaxRequestBodySize)

- **Cloudflare Worker 版本：**

    ```javascript
    maxRequestBodySize: 10 * 1024 * 1024; // 10MB
    maxRequestBodySize: 5 * 1024 * 1024; // 5MB
    maxRequestBodySize: 0; // 不限制
    ```

- **.NET 版本：**
    ```json
    "MaxRequestBodySize": 10485760, // 10MB
    "MaxRequestBodySize": 5242880, // 5MB
    "MaxRequestBodySize": 0 // 不限制
    ```

#### 绑定地址和端口（仅 .NET 版本）

```json
"BindIp": "0.0.0.0", // 绑定所有网络接口
"BindPort": 5000 // 绑定端口
```

#### 代理访问密钥 (proxyToken / ProxyToken)

- **Cloudflare Worker 版本：**

    ```javascript
    proxyToken: 'your-secret-token'; // 设置密钥
    proxyToken: ''; // 不验证（默认）
    ```

- **.NET 版本：**
    ```json
    "ProxyToken": "your-secret-token", // 设置密钥
    "ProxyToken": "" // 不验证（默认）
    ```

请求时需要在 Header 中添加 `x-proxy-key: your-secret-token`

#### IP 白名单 (ipWhitelist / IpWhitelist)

- **Cloudflare Worker 版本：**

    ```javascript
    // 多个 IP
    ipWhitelist: ['192.168.1.1', '10.0.0.1'];

    // 通配符匹配
    ipWhitelist: ['192.168.1.*', '10.0.*.*'];

    // CIDR 格式
    ipWhitelist: ['192.168.0.0/16', '10.0.0.0/8'];

    // 禁用
    ipWhitelist: [];
    ```

- **.NET 版本：**
    ```json
    "IpWhitelist": ["192.168.1.1", "10.0.0.1"], // 多个 IP
    "IpWhitelist": ["192.168.1.*", "10.0.*.*"], // 通配符匹配
    "IpWhitelist": ["192.168.0.0/16", "10.0.0.0/8"], // CIDR 格式
    "IpWhitelist": [] // 禁用
    ```

#### 请求方法白名单 (allowedMethods / AllowedMethods)

- **Cloudflare Worker 版本：**

    ```javascript
    allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH']; // 允许的方法
    allowedMethods: ['GET', 'POST']; // 只允许 GET 和 POST
    allowedMethods: []; // 不限制
    ```

- **.NET 版本：**
    ```json
    "AllowedMethods": ["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH"], // 允许的方法
    "AllowedMethods": ["GET", "POST"], // 只允许 GET 和 POST
    "AllowedMethods": [] // 不限制
    ```

#### 请求头过滤 (filteredHeaderPrefixes / FilteredHeaderPrefixes)

- **Cloudflare Worker 版本：**

    ```javascript
    filteredHeaderPrefixes: ['cf-']; // 过滤 cf- 开头的请求头（默认）
    filteredHeaderPrefixes: ['x-', 'cf-']; // 过滤 x- 和 cf- 开头
    filteredHeaderPrefixes: []; // 不过滤
    ```

- **.NET 版本：**
    ```json
    "FilteredHeaderPrefixes": ["cf-"], // 过滤 cf- 开头的请求头（默认）
    "FilteredHeaderPrefixes": ["x-", "cf-"], // 过滤 x- 和 cf- 开头
    "FilteredHeaderPrefixes": [] // 不过滤
    ```

#### 敏感请求头过滤 (filteredSensitiveHeaders / FilteredSensitiveHeaders)

- **Cloudflare Worker 版本：**

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

- **.NET 版本：**
    ```json
    "FilteredSensitiveHeaders": ["cookie", "authorization", "proxy-authorization", "proxy-authenticate", "sec-websocket-key", "sec-websocket-protocol"], // 默认过滤所有敏感请求头
    "FilteredSensitiveHeaders": [] // 不过滤任何敏感请求头
    ```

**注意：** 生产环境建议保持默认配置，过滤敏感请求头以防止凭证泄露。

#### 访问控制 (urlAccessControl / UrlAccessControl)

- **Cloudflare Worker 版本：**

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

- **.NET 版本：**
    ```json
    "UrlAccessControl": {
      "Mode": "whitelist",
      "Urls": ["example.com", "*.google.com", "https://api.test.com"]
    },
    "UrlAccessControl": {
      "Mode": "blacklist",
      "Urls": ["malicious.com", "*.ads.com"]
    },
    "UrlAccessControl": {
      "Mode": "none",
      "Urls": []
    }
    ```

#### 快捷地址映射 (urlShortcuts / UrlShortcuts)

- **Cloudflare Worker 版本：**

    ```javascript
    urlShortcuts: {
        'gh': 'https://github.com',
        'npm': 'https://www.npmjs.com'
    };
    ```

- **.NET 版本：**
    ```json
    "UrlShortcuts": {
      "gh": "https://github.com",
      "npm": "https://www.npmjs.com"
    }
    ```

使用方式：`http://localhost:5000/gh` 会被代理到 `https://github.com`

#### 内容替换规则 (replaceRules / ReplaceRules)

- **Cloudflare Worker 版本：**

    ```javascript
    replaceRules: [
    	// 简单替换
    	{
    		type: 'replace',
    		pattern: '旧内容',
    		replacement: '新内容',
    		direction: 'both',
    		host: 'example.com' // 选填：仅当目标域名匹配时才生效
    	},
    	// 正则替换
    	{
    		type: 'regex',
    		pattern: '正则表达式',
    		replacement: '替换内容',
    		direction: 'response'
    	},
    	// JSON key-value 替换
    	{
    		type: 'replace',
    		pattern: 'oldKey',
    		replacement: 'newKey',
    		direction: 'request',
    		jsonMode: 'keyValue'
    	}
    ];
    ```

- **.NET 版本：**
    ```json
    "ReplaceRules": [
      {
        "Type": "replace",
        "Pattern": "旧内容",
        "Replacement": "新内容",
        "Direction": "both",
        "Host": "example.com"
      },
      {
        "Type": "regex",
        "Pattern": "正则表达式",
        "Replacement": "替换内容",
        "Direction": "response"
      },
      {
        "Type": "replace",
        "Pattern": "oldKey",
        "Replacement": "newKey",
        "Direction": "request",
        "JsonMode": "keyValue"
      }
    ]
    ```

**参数说明：**

- `type` (`Type`): 替换方式
  - `replace`：简单替换，替换所有匹配的字符串
  - `exact`：精确匹配，与 replace 效果相同
  - `regex`：正则表达式替换
- `pattern` (`Pattern`): 需要匹配的字符串或正则表达式
- `replacement` (`Replacement`): 替换后的新内容
- `direction` (`Direction`): 作用方向
  - `request`：仅替换请求体（如 POST 提交的数据）
  - `response`：仅替换响应体（如返回的 HTML 或 JSON）
  - `both`：双向生效
- `jsonMode` (`JsonMode`): JSON 处理模式（默认 `whole`）
  - `whole`：将 JSON 作为普通字符串整体匹配
  - `keyValue`：仅当内容是有效 JSON 时，递归遍历 JSON，对所有键名和文本值进行独立替换
- `flags` (`Flags`): (可选) 正则标志。例如 `"gi"` (全局且忽略大小写)。`replace` 模式下仅支持 `i` 忽略大小写。
- `host` (`Host`): (可选) 指定生效的域名。如果配置了此项，则仅当目标网站的域名与此匹配时该条替换规则才会生效。

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

#### 首页配置 (homePage / HomePage)

- **Cloudflare Worker 版本：**

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

- **.NET 版本：**
    ```json
    "HomePage": {
      "StatusCode": 200,
      "Content": "Proxy Service Running"
    },
    "HomePage": {
      "StatusCode": 404,
      "Content": "Not Found"
    },
    "HomePage": {
      "StatusCode": null,
      "Content": ""
    }
    ```

#### HTML 路径重写 (htmlPathRewriteScope / HtmlPathRewriteScope)

- **Cloudflare Worker 版本：**

    ```javascript
    // 数组形式，可自由组合
    htmlPathRewriteScope: ['link', 'style', 'script', 'image', 'media', 'iframe', 'form'],  // 处理所有类型（默认）

    // 使用 all 关键字
    htmlPathRewriteScope: 'all'    // 所有类型

    // 禁用
    htmlPathRewriteScope: false
    htmlPathRewriteScope: []
    ```

- **.NET 版本：**
    ```json
    "HtmlPathRewriteScope": ["link", "style", "script", "image", "media", "iframe", "form"], // 处理所有类型（默认）
    "HtmlPathRewriteScope": ["all"], // 所有类型
    "HtmlPathRewriteScope": [] // 禁用
    ```

**可选值：**

- `link`: a 标签的 href
- `style`: link 标签的 href（样式文件）
- `script`: script 标签的 src
- `image`: img 标签的 src
- `media`: video/audio 标签的 src
- `iframe`: iframe 标签的 src
- `form`: form 标签的 action
- `all`: 所有类型

当启用时，会将 HTML 中的相对路径转换为代理服务器的绝对路径：

- `/css/style.css` → `http://localhost:5000/https%3A%2F%2Fexample.com/css/style.css`

#### 缓存配置 (disableCache / DisableCache)

- **Cloudflare Worker 版本：**

    ```javascript
    disableCache: true; // 禁用缓存，每次请求都从源站获取（默认）
    disableCache: false; // 允许缓存，由源站响应头控制
    ```

- **.NET 版本：**
    ```json
    "DisableCache": true, // 禁用缓存，每次请求都从源站获取（默认）
    "DisableCache": false // 允许缓存，由源站响应头控制
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

	// 代理访问密钥
	proxyToken: '',

	// IP 白名单
	ipWhitelist: [],

	// HTML 路径替换范围
	htmlPathRewriteScope: ['link', 'style', 'script', 'image', 'media', 'iframe', 'form'],

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

## 版权信息

- **作者**：木炭
- **项目地址**：[https://github.com/woodcoal/cloud-http-proxy](https://github.com/woodcoal/cloud-http-proxy)
