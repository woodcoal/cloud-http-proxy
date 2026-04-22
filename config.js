/**
 * config.js - 代理服务配置文件
 * 将配置独立出来方便维护和部署
 *
 * ⚠️ 免责声明：本项目仅供学习和技术研究使用，请勿用于任何违法、违规或破坏性用途。因滥用本项目导致的任何法律责任，由使用者自行承担。
 */

// ==================== 配置区域 ====================
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
	// type: 替换方式 - 'replace'（简单替换）, 'regex'（正则替换）, 'exact'（精确匹配）
	// direction: 作用方向 - 'request'（请求体）, 'response'（响应体）, 'both'（两者都）
	// jsonMode: JSON 替换模式 - 'whole'（整体替换，默认）, 'keyValue'（key-value 单独替换，仅对 JSON 有效）
	replaceRules: [
		// 示例：
		// { type: 'regex', pattern: '旧内容', replacement: '新内容', direction: 'both' },
		// { type: 'replace', pattern: '旧字符串', replacement: '新字符串', direction: 'response' },
		// { type: 'exact', pattern: '完整匹配内容', replacement: '替换内容', direction: 'request' },
		// { type: 'replace', pattern: 'oldKey', replacement: 'newKey', direction: 'request', jsonMode: 'keyValue' }, // 替换 JSON 的 key
		// { type: 'replace', pattern: 'oldValue', replacement: 'newValue', direction: 'request', jsonMode: 'keyValue' }, // 替换 JSON 的 value
	],

	// ==================== 首页配置 ====================

	// 默认首页（根路径 /）配置
	homePage: {
		// 状态码：200、404、500 等，设置为 null 表示返回空响应
		statusCode: 200,
		// 返回的文本内容
		content: 'Proxy Service Running'
	},

	// ==================== HTML 路径配置 ====================

	// 是否启用 HTML 相对路径替换
	enableHtmlPathRewrite: true,

	// ==================== 缓存配置 ====================

	// 是否禁用响应缓存
	disableCache: true
};

// ==================== 配置区域结束 ====================

// 导出配置
export default CONFIG;
