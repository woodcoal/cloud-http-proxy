/**
 * server.js - Node.js 版本的 HTTP 代理服务
 * 功能：作为反向代理，代理任意 URL 请求并处理 HTML 内容中的相对路径
 *
 * ⚠️ 免责声明：本项目仅供学习和技术研究使用，请勿用于任何违法、违规或破坏性用途。
 * 因滥用本项目导致的任何法律责任，由使用者自行承担。
 */

const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const cors = require('cors');
const compression = require('compression');

// 加载配置文件
const CONFIG = require('./config');

// ==================== 初始化 Express 应用 ====================
const app = express();

// 启用压缩
app.use(compression());

// 启用 CORS
app.use(cors({
	origin: '*',
	methods: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH'],
	allowedHeaders: '*'
}));

// 解析请求体
app.use(express.json({ limit: CONFIG.maxRequestBodySize || '10mb' }));
app.use(express.text({ limit: CONFIG.maxRequestBodySize || '10mb' }));
app.use(express.urlencoded({ extended: true, limit: CONFIG.maxRequestBodySize || '10mb' }));
app.use(express.raw({ limit: CONFIG.maxRequestBodySize || '10mb' }));

// ==================== 中间件函数 ====================

/**
 * 检查 IP 是否在白名单中
 * @param {string} clientIp - 客户端 IP
 * @returns {boolean} 是否允许
 */
function isIpAllowed(clientIp) {
	const ipWhitelist = CONFIG.ipWhitelist;

	if (!ipWhitelist || ipWhitelist.length === 0) {
		return true;
	}

	for (const pattern of ipWhitelist) {
		if (matchIpPattern(clientIp, pattern)) {
			return true;
		}
	}

	return false;
}

/**
 * 检查客户端 IP 是否匹配白名单模式
 * @param {string} clientIp - 客户端 IP
 * @param {string} pattern - 白名单模式
 * @returns {boolean} 是否匹配
 */
function matchIpPattern(clientIp, pattern) {
	if (clientIp === pattern) {
		return true;
	}

	if (pattern.includes('*')) {
		const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
		const regex = new RegExp(`^${regexPattern}$`);
		return regex.test(clientIp);
	}

	if (pattern.includes('/')) {
		return cidrMatch(clientIp, pattern);
	}

	return false;
}

/**
 * 检查 IP 是否在 CIDR 范围内
 * @param {string} ip - IP 地址
 * @param {string} cidr - CIDR 格式
 * @returns {boolean} 是否在范围内
 */
function cidrMatch(ip, cidr) {
	const [range, bits] = cidr.split('/');
	const bitsNum = parseInt(bits);

	if (bitsNum === 0) {
		return true;
	}

	const mask = ~((1 << (32 - bitsNum)) - 1) >>> 0;
	const ipNum = ipToNumber(ip);
	const rangeNum = ipToNumber(range);

	return (ipNum & mask) >>> 0 === (rangeNum & mask) >>> 0;
}

/**
 * 将 IP 地址转换为数字
 * @param {string} ip - IP 地址
 * @returns {number} IP 数字
 */
function ipToNumber(ip) {
	return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
}

/**
 * 检查 Token 是否有效
 * @param {Request} req - 请求对象
 * @returns {boolean} 是否有效
 */
function isTokenValid(req) {
	const token = CONFIG.proxyToken;

	if (!token) {
		return true;
	}

	const requestToken = req.headers['x-proxy-key'];
	return requestToken === token;
}

/**
 * 检查请求方法是否被允许
 * @param {string} method - 请求方法
 * @returns {boolean} 是否允许
 */
function isMethodAllowed(method) {
	if (CONFIG.allowedMethods.length === 0) {
		return true;
	}
	return CONFIG.allowedMethods.includes(method.toUpperCase());
}

/**
 * 检查是否为敏感请求头
 * @param {string} name - 请求头名称
 * @returns {boolean} 是否为敏感请求头
 */
function isSensitiveHeader(name) {
	if (CONFIG.filteredSensitiveHeaders.length === 0) {
		return false;
	}
	return CONFIG.filteredSensitiveHeaders.includes(name.toLowerCase());
}

/**
 * 检查请求头是否应该被过滤
 * @param {string} name - 请求头名称
 * @returns {boolean} 是否应该过滤
 */
function isHeaderFiltered(name) {
	if (CONFIG.filteredHeaderPrefixes.length === 0) {
		return false;
	}
	return CONFIG.filteredHeaderPrefixes.some((prefix) =>
		name.toLowerCase().startsWith(prefix.toLowerCase())
	);
}

/**
 * 检查 URL 是否在白名单/黑名单中
 * @param {string} urlStr - 要检查的 URL 字符串
 * @returns {boolean} 是否允许访问
 */
function isUrlAllowed(urlStr) {
	const { mode, urls } = CONFIG.urlAccessControl;

	if (mode === 'none' || !urls || urls.length === 0) {
		return true;
	}

	try {
		const url = new URL(urlStr);
		const urlOrigin = url.origin;
		const urlHostname = url.hostname;
		const urlPathname = url.pathname;
		const fullUrl = url.toString();

		for (const pattern of urls) {
			let isMatch = false;

			try {
				if (pattern.includes('*')) {
					const regexPattern = pattern
						.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
						.replace(/\*/g, '.*');
					const regex = new RegExp(`^${regexPattern}$`, 'i');
					isMatch = regex.test(urlHostname) || regex.test(fullUrl);
				} else {
					const patternUrl = pattern.startsWith('http')
						? new URL(pattern)
						: new URL('https://' + pattern);

					if (patternUrl.origin === urlOrigin) {
						if (patternUrl.pathname && patternUrl.pathname !== '/') {
							isMatch = urlPathname.startsWith(patternUrl.pathname);
						} else {
							isMatch = true;
						}
					}
				}
			} catch (e) {
				isMatch = urlHostname.includes(pattern) || fullUrl.includes(pattern);
			}

			if (isMatch) {
				if (mode === 'whitelist') {
					return true;
				}
				if (mode === 'blacklist') {
					return false;
				}
			}
		}

		if (mode === 'whitelist') {
			return false;
		}

		return true;
	} catch (e) {
		return false;
	}
}

/**
 * 确保 URL 带有协议
 * @param {string} url - 要检查的 URL 字符串
 * @param {string} defaultProtocol - 默认协议
 * @returns {string} 带有协议的 URL 字符串
 */
function ensureProtocol(url, defaultProtocol) {
	return url.startsWith('http://') || url.startsWith('https://')
		? url
		: defaultProtocol + '//' + url;
}

/**
 * 处理 HTML 内容中的相对路径
 * @param {string} text - HTML 文本
 * @param {string} protocol - 当前代理的协议
 * @param {string} host - 当前代理的主机名
 * @param {string} actualUrlStr - 实际的目标 URL 字符串
 * @returns {string} 处理后的 HTML 文本
 */
function handleHtmlContent(text, protocol, host, actualUrlStr) {
	const targetOrigin = new URL(actualUrlStr).origin;
	const protocolName = protocol.replace(':', '');

	const scopeConfig = {
		link: { tag: 'a', attr: 'href' },
		style: { tag: 'link', attr: 'href' },
		script: { tag: 'script', attr: 'src' },
		image: { tag: 'img', attr: 'src' },
		media: { tag: '(?:video|audio)', attr: 'src' },
		iframe: { tag: 'iframe', attr: 'src' },
		form: { tag: 'form', attr: 'action' }
	};

	const scope = CONFIG.htmlPathRewriteScope;

	if (!scope) {
		return text;
	}

	const processUrl = (htmlText, attrName, tagPattern = null) => {
		// 相对路径正则 - 无论是否有 tagPattern，都使用相同的捕获组逻辑
		const relativeRegex = tagPattern
			? new RegExp(`(<${tagPattern}[^>]*\\s+)${attrName}=["\'](\\/[^"']*)["\']`, 'gi')
			: new RegExp(`(\\s+)${attrName}=["\'](\\/[^"']*)["\']`, 'g');

		htmlText = htmlText.replace(relativeRegex, (match, prefix, path) => {
			if (path.includes(host)) {
				return match;
			}
			const encodedTarget = encodeURIComponent(targetOrigin);
			return `${prefix}${attrName}="${protocolName}://${host}/${encodedTarget}${path}"`;
		});

		// 绝对路径正则
		const absoluteRegex = tagPattern
			? new RegExp(
					`(<${tagPattern}[^>]*\\s+)${attrName}=["\']((?:https?:)?\\/\\/[^"']*)["\']`,
					'gi'
				)
			: new RegExp(`(\\s+)${attrName}=["\']((?:https?:)?\\/\\/[^"']*)["\']`, 'g');

		htmlText = htmlText.replace(absoluteRegex, (match, prefix, url) => {
			if (url.startsWith(`https://${host}/`) || url.startsWith(`http://${host}/`)) {
				return match;
			}
			let fullUrl = url;
			if (!url.startsWith('http://') && !url.startsWith('https://')) {
				fullUrl = 'https:' + url;
			}
			const encodedUrl = encodeURIComponent(fullUrl);
			return `${prefix}${attrName}="${protocolName}://${host}/${encodedUrl}"`;
		});

		return htmlText;
	};

	let scopesToProcess = [];

	if (scope === 'all' || (Array.isArray(scope) && scope.includes('all'))) {
		text = processUrl(text, 'href');
		text = processUrl(text, 'src');
		text = processUrl(text, 'action');
		return text;
	} else if (Array.isArray(scope) && scope.length > 0) {
		scopesToProcess = scope;
	} else {
		return text;
	}

	const attrsToProcess = [
		...new Set(scopesToProcess.map((s) => scopeConfig[s]?.attr).filter(Boolean))
	];

	attrsToProcess.forEach((attr) => {
		const tags = [
			...new Set(
				scopesToProcess
					.filter((s) => scopeConfig[s]?.attr === attr)
					.map((s) => scopeConfig[s].tag)
			)
		];

		tags.forEach((tag) => {
			text = processUrl(text, attr, tag);
		});
	});

	return text;
}

/**
 * 检查是否有指定方向的替换规则
 * @param {string} direction - 方向
 * @returns {boolean} 是否有匹配的规则
 */
function hasReplaceRule(direction) {
	return CONFIG.replaceRules.some(
		(rule) => rule.direction === direction || rule.direction === 'both'
	);
}

/**
 * 应用替换规则
 * @param {string} text - 原始文本
 * @param {string} direction - 方向
 * @returns {string} 替换后的文本
 */
function applyReplaceRules(text, direction) {
	const rules = CONFIG.replaceRules.filter(
		(rule) => rule.direction === direction || rule.direction === 'both'
	);

	for (const rule of rules) {
		const { type, pattern, replacement, jsonMode, flags } = rule;

		if (!pattern || replacement === undefined) {
			continue;
		}

		if (jsonMode === 'keyValue' && isJsonString(text)) {
			try {
				text = applyJsonReplace(text, type, pattern, replacement, flags);
				continue;
			} catch (e) {
			}
		}

		switch (type) {
			case 'regex':
				try {
					const regexFlags = flags || 'g';
					const regex = new RegExp(pattern, regexFlags);
					text = text.replace(regex, replacement);
				} catch (e) {
				}
				break;
			case 'exact':
				text = text.split(pattern).join(replacement);
				break;
			case 'replace':
			default:
				if (flags && flags.includes('i')) {
					const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
					text = text.replace(regex, replacement);
				} else {
					text = text.split(pattern).join(replacement);
				}
				break;
		}
	}

	return text;
}

/**
 * 检查字符串是否为有效的 JSON
 * @param {string} str - 要检查的字符串
 * @returns {boolean} 是否为 JSON
 */
function isJsonString(str) {
	try {
		const parsed = JSON.parse(str);
		return typeof parsed === 'object' && parsed !== null;
	} catch (e) {
		return false;
	}
}

/**
 * 对 JSON 进行 key-value 替换
 * @param {string} jsonText - JSON 字符串
 * @param {string} type - 替换类型
 * @param {string} pattern - 要替换的内容
 * @param {string} replacement - 替换后的内容
 * @param {string} flags - 正则标志
 * @returns {string} 替换后的 JSON 字符串
 */
function applyJsonReplace(jsonText, type, pattern, replacement, flags) {
	const parsed = JSON.parse(jsonText);

	function traverse(obj) {
		if (Array.isArray(obj)) {
			return obj.map((item) => traverse(item));
		} else if (obj !== null && typeof obj === 'object') {
			const result = {};
			for (const [key, value] of Object.entries(obj)) {
				let newKey = key;
				let newValue = value;

				newKey = applyReplace(key, type, pattern, replacement, flags);
				newValue = traverse(value);

				result[newKey] = newValue;
			}
			return result;
		} else if (typeof obj === 'string') {
			return applyReplace(obj, type, pattern, replacement, flags);
		}
		return obj;
	}

	function applyReplace(str, type, pattern, replacement, flags) {
		switch (type) {
			case 'regex':
				try {
					const regexFlags = flags || 'g';
					const regex = new RegExp(pattern, regexFlags);
					return str.replace(regex, replacement);
				} catch (e) {
					return str;
				}
			case 'exact':
			case 'replace':
			default:
				if (flags && flags.includes('i')) {
					const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
					return str.replace(regex, replacement);
				}
				return str.split(pattern).join(replacement);
		}
	}

	const result = traverse(parsed);
	return JSON.stringify(result);
}

// ==================== 路由处理 ====================

/**
 * 认证和访问控制中间件
 */
function authMiddleware(req, res, next) {
	// 获取客户端 IP
	const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
		req.headers['x-real-ip'] ||
		req.connection.remoteAddress ||
		req.socket.remoteAddress ||
		'unknown';

	// 检查 IP 白名单
	if (!isIpAllowed(clientIp)) {
		return res.status(403).json({ error: 'IP 不在白名单中' });
	}

	// 检查 Token
	if (!isTokenValid(req)) {
		return res.status(401).json({ error: 'Token 验证失败' });
	}

	// 检查请求方法
	if (!isMethodAllowed(req.method)) {
		return res.status(405).json({ error: `不支持的请求方法: ${req.method}` });
	}

	next();
}

/**
 * 处理首页请求
 */
app.get('/', (req, res) => {
	const { statusCode, content } = CONFIG.homePage;

	if (statusCode === null || statusCode === undefined) {
		return res.status(200).send('');
	}

	res.status(statusCode).set('Content-Type', 'text/html; charset=utf-8').send(content);
});

/**
 * 使用原生 http/https 模块代理请求
 * @param {string} targetUrl - 目标 URL
 * @param {object} options - 代理选项
 * @returns {Promise<{statusCode, headers, body}>}
 */
function proxyRequest(targetUrl, options) {
	return new Promise((resolve, reject) => {
		const url = new URL(targetUrl);
		const isHttps = url.protocol === 'https:';
		const client = isHttps ? https : http;

		// 设置正确的 Host 头
		const requestHeaders = { ...options.headers };
		requestHeaders.host = url.port ? `${url.hostname}:${url.port}` : url.hostname;

		// 删除 accept-encoding，避免接收压缩响应
		delete requestHeaders['accept-encoding'];
		delete requestHeaders['Accept-Encoding'];

		const requestOptions = {
			hostname: url.hostname,
			port: url.port || (isHttps ? 443 : 80),
			path: url.pathname + url.search,
			method: options.method,
			headers: requestHeaders,
			timeout: options.timeout || 30000
		};

		const proxyReq = client.request(requestOptions, (proxyRes) => {
			const chunks = [];
			proxyRes.on('data', (chunk) => chunks.push(chunk));
			proxyRes.on('end', () => {
				const body = Buffer.concat(chunks);
				resolve({
					statusCode: proxyRes.statusCode,
					headers: proxyRes.headers,
					body: body
				});
			});
		});

		proxyReq.on('error', reject);
		proxyReq.on('timeout', () => {
			proxyReq.destroy();
			reject(new Error('Request timeout'));
		});

		if (options.body) {
			proxyReq.write(options.body);
		}

		proxyReq.end();
	});
}

/**
 * 处理代理请求
 */
app.all('*', authMiddleware, async (req, res) => {
	try {
		const originalPath = req.path.substring(1);
		let targetUrl = decodeURIComponent(originalPath);

		// 检查是否为快捷地址
		const shortcuts = CONFIG.urlShortcuts || {};
		const pathParts = targetUrl.split('/');
		const firstPart = pathParts[0];
		const isShortcut = !!shortcuts[firstPart];

		let actualUrlStr;
		if (isShortcut) {
			let shortcutUrl = shortcuts[firstPart];
			const remainingPath = pathParts.slice(1).join('/');
			shortcutUrl = remainingPath ? `${shortcutUrl}/${remainingPath}` : shortcutUrl;
			actualUrlStr = ensureProtocol(shortcutUrl, 'https:');
		} else {
			actualUrlStr = ensureProtocol(targetUrl, 'https:');
		}

		// 保存用于重定向解析的基础 URL（必须在添加查询参数之前）
		const targetUrlForRedirect = actualUrlStr;

		// 保留查询参数
		if (req.url.includes('?')) {
			actualUrlStr += '?' + req.url.split('?')[1];
		}

		// 检查 URL 访问控制
		if (!isShortcut && !isUrlAllowed(actualUrlStr)) {
			return res.status(403).json({ error: '该地址不允许访问' });
		}

		// 过滤请求头
		const filteredHeaders = {};
		for (const [key, value] of Object.entries(req.headers)) {
			if (!isHeaderFiltered(key) && !isSensitiveHeader(key)) {
				filteredHeaders[key] = value;
			}
		}

		// 准备请求体
		let requestBody = null;
		if (req.body && req.method !== 'GET' && req.method !== 'HEAD') {
			if (Buffer.isBuffer(req.body)) {
				requestBody = req.body;
			} else if (typeof req.body === 'string') {
				requestBody = Buffer.from(req.body);
			} else {
				requestBody = Buffer.from(JSON.stringify(req.body));
			}

			// 应用请求替换规则
			if (hasReplaceRule('request')) {
				const bodyStr = requestBody.toString('utf-8');
				const modifiedBody = applyReplaceRules(bodyStr, 'request');
				requestBody = Buffer.from(modifiedBody);
			}
		}

		// 发送代理请求
		const proxyRes = await proxyRequest(actualUrlStr, {
			method: req.method,
			headers: filteredHeaders,
			body: requestBody,
			timeout: CONFIG.timeout
		});

		// 处理重定向
		if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode)) {
			const location = proxyRes.headers['location'];
			if (location) {
				try {
					const absoluteUrl = new URL(location, targetUrlForRedirect);
					proxyRes.headers['location'] = '/' + encodeURIComponent(absoluteUrl.toString());
				} catch {
					proxyRes.headers['location'] = '/' + encodeURIComponent(location);
				}
			}
		}

		// 禁用缓存
		if (CONFIG.disableCache) {
			proxyRes.headers['cache-control'] = 'no-store';
		}

		// 处理响应体
		let responseBody = proxyRes.body.toString('utf-8');

		// 处理 HTML 内容
		const contentType = proxyRes.headers['content-type'] || '';
		if (contentType.includes('text/html') && CONFIG.htmlPathRewriteScope) {
			responseBody = handleHtmlContent(
				responseBody,
				req.protocol + ':',
				req.headers.host,
				targetUrlForRedirect
			);
		}

		// 移除常见的 HTTPS 强制跳转脚本（如百度）
		responseBody = responseBody.replace(
			/<script>\s*location\.replace\(location\.href\.replace\(["']https:\/\/["'],\s*["']http:\/\/["']\)\)\s*;?\s*<\/script>/gi,
			''
		);
		// 移除 noscript 中的跳转 meta 标签
		responseBody = responseBody.replace(
			/<noscript>\s*<meta[^>]*http-equiv=["']refresh["'][^>]*>\s*<\/noscript>/gi,
			''
		);

		// 应用响应替换规则
		if (hasReplaceRule('response')) {
			responseBody = applyReplaceRules(responseBody, 'response');
		}

		// 发送响应
		res.status(proxyRes.statusCode);
		for (const [key, value] of Object.entries(proxyRes.headers)) {
			if (key !== 'content-length') {
				res.setHeader(key, value);
			}
		}
		res.send(responseBody);

	} catch (error) {
		if (error.message === 'Request timeout') {
			res.status(504).json({ error: '请求超时' });
		} else {
			res.status(500).json({ error: error.message });
		}
	}
});

// ==================== 启动服务 ====================
app.listen(CONFIG.port, () => {
	console.log(`代理服务器运行在端口 ${CONFIG.port}`);
	console.log(`访问格式: http://localhost:${CONFIG.port}/<目标URL>`);
});
