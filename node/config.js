/**
 * config.js - 代理服务器配置文件
 */

module.exports = {
	// 服务监听端口
	port: process.env.PORT || 3000,

	// 请求超时时间（毫秒），设置为 0 表示不限制
	timeout: 30000,

	// 请求体大小限制（字节），默认 10MB，设置为 0 表示不限制
	maxRequestBodySize: 10 * 1024 * 1024,

	// 允许的请求方法，设置为空数组表示不限制
	allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH'],

	// 代理访问密钥，请求头 x-proxy-key 需要与此匹配才能访问
	// 设置为空字符串或不设置则不验证
	proxyToken: '',

	// IP 白名单，设置为空数组表示不限制
	// 支持 IPv4 和 IPv6 格式，可使用 * 通配符
	// 例如：['192.168.1.1', '10.0.0.*', '172.16.0.0/16']
	ipWhitelist: [],

	// 要过滤的请求头前缀（这些开头的请求头将被移除）
	// 例如：['cf-'] 会过滤所有 cf- 开头的请求头
	filteredHeaderPrefixes: [],

	// 要过滤的敏感请求头（这些请求头将被移除，防止泄露认证信息）
	// 设置为空数组表示不过滤任何敏感请求头
	filteredSensitiveHeaders: [
		'cookie',
		'authorization',
		'proxy-authorization',
		'proxy-authenticate',
		'sec-websocket-key',
		'sec-websocket-protocol'
	],

	// 代理地址黑白名单
	urlAccessControl: {
		mode: 'none', // 'whitelist'（白名单）, 'blacklist'（黑名单）, 'none'（不限制）
		urls: []
	},

	// 快捷地址映射
	// 访问时：/a 相当于访问 x.com，/b 相当于访问 y.net/z
	urlShortcuts: {
		// a: 'https://x.com',
		// b: 'https://y.net/z'
	},

	// 内容替换规则
	// type: 替换方式 - 'replace'（简单替换）, 'regex'（正则替换）, 'exact'（精确匹配）
	// direction: 作用方向 - 'request'（请求体）, 'response'（响应体）, 'both'（两者都）
	// jsonMode: JSON 替换模式 - 'whole'（整体替换，默认）, 'keyValue'（key-value 单独替换，仅对 JSON 有效）
	// flags: 正则标志（可选）- 'g'（全局）, 'i'（不区分大小写）, 'gi'（全局+不区分大小写）
	replaceRules: [],

	// 默认首页（根路径 /）配置
	homePage: {
		statusCode: 404,
		content: ''
	},

	// HTML 路径替换范围（数组形式，可组合）
	// 'link': a 标签的 href
	// 'style': link 标签的 href（样式文件）
	// 'script': script 标签的 src
	// 'image': img 标签的 src
	// 'media': video/audio 标签的 src
	// 'iframe': iframe 标签的 src
	// 'form': form 标签的 action
	// 'all': 所有类型
	// 设置为 false 禁用，或空数组 []
	htmlPathRewriteScope: ['link', 'style', 'script', 'image', 'media', 'iframe', 'form'],

	// 是否禁用响应缓存
	disableCache: true
};
