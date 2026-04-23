/**
 * worker.js - Cloudflare Worker 代理服务
 * 功能：作为反向代理，代理任意 URL 请求并处理 HTML 内容中的相对路径
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

	// ==================== 认证配置 ====================

	// 代理访问密钥，请求头 x-proxy-key 需要与此匹配才能访问
	// 设置为空字符串或不设置则不验证
	proxyToken: '',

	// IP 白名单，设置为空数组表示不限制
	// 支持 IPv4 和 IPv6 格式，可使用 * 通配符
	// 例如：['192.168.1.1', '10.0.0.*', '172.16.0.0/16']
	ipWhitelist: [],

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
	// 访问时：/a 相当于访问 x.com，/b 相当于访问 y.net/z
	urlShortcuts: {
		// a: 'https://x.com',
		// b: 'https://y.net/z'
	},

	// ==================== 内容替换配置 ====================

	// 内容替换规则
	// type: 替换方式 - 'replace'（简单替换）, 'regex'（正则替换）, 'exact'（精确匹配）
	// direction: 作用方向 - 'request'（请求体）, 'response'（响应体）, 'both'（两者都）
	// jsonMode: JSON 替换模式 - 'whole'（整体替换，默认）, 'keyValue'（key-value 单独替换，仅对 JSON 有效）
	// flags: 正则标志（可选）- 'g'（全局）, 'i'（不区分大小写）, 'gi'（全局+不区分大小写）
	// host: 指定域名（可选）- 如果设置了，则仅当目标域名（或实际请求域名）匹配时才生效
	replaceRules: [
		// 示例：
		// { type: 'regex', pattern: '旧内容', replacement: '新内容', direction: 'both' },
		// { type: 'replace', pattern: '旧字符串', replacement: '新字符串', direction: 'response', host: 'example.com' },
		// { type: 'replace', pattern: '旧字符串', replacement: '新字符串', direction: 'response' },
		// { type: 'replace', pattern: 'abc', replacement: 'xyz', direction: 'request', flags: 'gi' }, // 不区分大小写替换
		// { type: 'replace', pattern: 'oldKey', replacement: 'newKey', direction: 'request', jsonMode: 'keyValue' }, // 替换 JSON 的 key
		// { type: 'replace', pattern: 'oldValue', replacement: 'newValue', direction: 'request', jsonMode: 'keyValue' }, // 替换 JSON 的 value
	],

	// ==================== 首页配置 ====================

	// 默认首页（根路径 /）配置
	homePage: {
		// 状态码：200、404、500 等，设置为 null 表示返回空响应
		statusCode: 404,

		// 返回的文本内容
		content: ''
	},

	// ==================== HTML 路径配置 ====================

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

	// ==================== 缓存配置 ====================

	// 是否禁用响应缓存
	disableCache: true
};

addEventListener('fetch', (event) => {
	event.respondWith(handleRequest(event.request));
});

/**
 * 处理所有传入的请求
 * @param {Request} request - 传入的请求对象
 * @returns {Promise<Response>} 代理后的响应
 */
async function handleRequest(request) {
	try {
		// 检查 IP 白名单
		if (!isIpAllowed(request)) {
			return jsonResponse({ error: 'IP 不在白名单中' }, 403);
		}

		// 检查 proxyToken
		if (!isTokenValid(request)) {
			return jsonResponse({ error: 'Token 验证失败' }, 401);
		}

		// 检查请求方法是否在白名单中
		if (!isMethodAllowed(request.method)) {
			return jsonResponse({ error: `不支持的请求方法: ${request.method}` }, 405);
		}

		// 检查请求体大小
		if (!isRequestBodySizeAllowed(request)) {
			return jsonResponse({ error: '请求体过大' }, 413);
		}

		const url = new URL(request.url);

		// 如果访问根目录，返回自定义响应
		if (url.pathname === '/') {
			return handleHomePage();
		}

		// 从请求路径中提取目标 URL
		let actualUrlStr = decodeURIComponent(url.pathname.replace('/', ''));

		// 检查是否为快捷地址
		const shortcuts = CONFIG.urlShortcuts || {};
		const pathParts = actualUrlStr.split('/');
		const firstPart = pathParts[0];
		const isShortcut = !!shortcuts[firstPart];
		if (isShortcut) {
			// 快捷地址：/a/path -> shortcut + /path
			let shortcutUrl = shortcuts[firstPart];
			const remainingPath = pathParts.slice(1).join('/');
			shortcutUrl = remainingPath ? `${shortcutUrl}/${remainingPath}` : shortcutUrl;
			// 确保快捷地址有协议
			actualUrlStr = ensureProtocol(shortcutUrl, url.protocol);
		} else {
			// 判断用户输入的 URL 是否带有协议
			actualUrlStr = ensureProtocol(actualUrlStr, url.protocol);
		}

		// 保留查询参数
		actualUrlStr += url.search;

		// 检查 URL 是否在白名单/黑名单中，非快捷地址时才检查
		if (!isShortcut && !isUrlAllowed(actualUrlStr)) {
			return jsonResponse({ error: '该地址不允许访问' }, 403);
		}

		// 创建新 Headers 对象，排除敏感请求头和指定前缀的请求头
		const newHeaders = filterHeaders(
			request.headers,
			(name) => !isHeaderFiltered(name) && !isSensitiveHeader(name)
		);

		// 创建一个新的请求以访问目标 URL
		const modifiedRequest = new Request(actualUrlStr, {
			headers: newHeaders,
			method: request.method,
			body: request.body,
			redirect: 'manual'
		});

		// 替换请求体内容
		let finalRequest = modifiedRequest;
		if (request.body && hasReplaceRule('request')) {
			finalRequest = await replaceRequestBody(modifiedRequest, actualUrlStr);
		}

		// 发起对目标 URL 的请求（支持超时）
		const response = await fetchWithTimeout(finalRequest, CONFIG.timeout);

		// 处理重定向
		if ([301, 302, 303, 307, 308].includes(response.status)) {
			return handleRedirect(response, actualUrlStr);
		}

		// 处理 HTML 内容中的相对路径（需要先读取 body）
		let body = response.body;
		const htmlScope = CONFIG.htmlPathRewriteScope;
		const isHtmlRewriteEnabled = htmlScope && Array.isArray(htmlScope) && htmlScope.length > 0;
		if (isHtmlRewriteEnabled && response.headers.get('Content-Type')?.includes('text/html')) {
			// 创建一个新的 Response 来保存 body，防止被消耗后无法再次读取
			const text = await new Response(body).text();
			const processedText = handleHtmlContent(text, url.protocol, url.host, actualUrlStr);
			body = new Response(processedText, {
				status: response.status,
				headers: response.headers
			}).body;
		}

		// 替换响应体内容
		if (hasReplaceRule('response')) {
			body = await replaceResponseBody(body, response, actualUrlStr);
		}

		// 创建修改后的响应对象
		const modifiedResponse = new Response(body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers
		});

		// 添加禁用缓存的头部
		setNoCacheHeaders(modifiedResponse.headers);

		// 添加 CORS 头部，允许跨域访问
		setCorsHeaders(modifiedResponse.headers);

		return modifiedResponse;
	} catch (error) {
		// 如果是超时错误
		if (error.name === 'AbortError') {
			return jsonResponse({ error: '请求超时' }, 504);
		}

		// 如果请求目标地址时出现错误，返回带有错误消息的响应和状态码 500（服务器错误）
		return jsonResponse({ error: error.message }, 500);
	}
}

/**
 * 处理默认首页请求
 * @returns {Response} 自定义的首页响应
 */
function handleHomePage() {
	const { statusCode, content } = CONFIG.homePage;

	if (statusCode === null || statusCode === undefined) {
		return new Response('', {
			headers: {
				'Content-Type': 'text/html; charset=utf-8'
			}
		});
	}

	return new Response(content, {
		status: statusCode,
		headers: {
			'Content-Type': 'text/html; charset=utf-8'
		}
	});
}

/**
 * 检查 IP 是否在白名单中
 * @param {Request} request - 请求对象
 * @returns {boolean} 是否允许
 */
function isIpAllowed(request) {
	const ipWhitelist = CONFIG.ipWhitelist;

	// 如果白名单为空，不限制
	if (!ipWhitelist || ipWhitelist.length === 0) {
		return true;
	}

	// 获取客户端 IP（Cloudflare 会通过 cf-connecting-ip 提供）
	const clientIp =
		request.headers.get('cf-connecting-ip') ||
		request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
		'unknown';

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
	// 完全匹配
	if (clientIp === pattern) {
		return true;
	}

	// 通配符匹配（如 192.168.1.*）
	if (pattern.includes('*')) {
		const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
		const regex = new RegExp(`^${regexPattern}$`);
		return regex.test(clientIp);
	}

	// CIDR 匹配（如 192.168.0.0/16）
	if (pattern.includes('/')) {
		return cidrMatch(clientIp, pattern);
	}

	return false;
}

/**
 * 检查 IP 是否在 CIDR 范围内
 * @param {string} ip - IP 地址
 * @param {string} cidr - CIDR 格式（如 192.168.0.0/16）
 * @returns {boolean} 是否在范围内
 */
function cidrMatch(ip, cidr) {
	const [range, bits] = cidr.split('/');
	const bitsNum = parseInt(bits);

	// 处理 /0 的情况（匹配所有 IP）
	if (bitsNum === 0) {
		return true;
	}

	// 使用无符号右移避免溢出
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
 * @param {Request} request - 请求对象
 * @returns {boolean} 是否有效
 */
function isTokenValid(request) {
	const token = CONFIG.proxyToken;

	// 如果 token 为空，不验证
	if (!token) {
		return true;
	}

	const requestToken = request.headers.get('x-proxy-key');
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
 * 检查请求体大小是否超限
 * @param {Request} request - 请求对象
 * @returns {Promise<boolean>} 是否允许
 */
async function isRequestBodySizeAllowed(request) {
	if (CONFIG.maxRequestBodySize === 0) {
		return true;
	}

	const contentLength = request.headers.get('content-length');
	if (!contentLength) {
		return true;
	}

	return parseInt(contentLength) <= CONFIG.maxRequestBodySize;
}

/**
 * 检查是否为敏感请求头（根据配置）
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
 * 检查请求头是否应该被过滤（根据配置的前缀）
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

	// 如果模式为 none 或列表为空，允许访问
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
				// 检查是否为通配符模式
				if (pattern.includes('*')) {
					// 将通配符模式转换为正则
					const regexPattern = pattern
						.replace(/[.+?^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
						.replace(/\*/g, '.*'); // * 转换为 .*
					const regex = new RegExp(`^${regexPattern}$`, 'i');
					isMatch = regex.test(urlHostname) || regex.test(fullUrl);
				} else {
					// 完整 URL 或域名匹配
					const patternUrl = pattern.startsWith('http')
						? new URL(pattern)
						: new URL('https://' + pattern);

					// 检查是否完全匹配 origin
					if (patternUrl.origin === urlOrigin) {
						// 如果配置了路径，检查路径是否匹配
						if (patternUrl.pathname && patternUrl.pathname !== '/') {
							isMatch = urlPathname.startsWith(patternUrl.pathname);
						} else {
							isMatch = true;
						}
					}
				}
			} catch (e) {
				// 解析失败，尝试简单的字符串包含匹配
				isMatch = urlHostname.includes(pattern) || fullUrl.includes(pattern);
			}

			if (isMatch) {
				// 白名单模式：匹配则允许
				if (mode === 'whitelist') {
					return true;
				}
				// 黑名单模式：匹配则拒绝
				if (mode === 'blacklist') {
					return false;
				}
			}
		}

		// 白名单模式：不在列表中则拒绝
		if (mode === 'whitelist') {
			return false;
		}

		// 黑名单模式：不在列表中则允许
		return true;
	} catch (e) {
		// URL 解析失败，拒绝访问
		return false;
	}
}

/**
 * 带超时的 fetch 请求
 * @param {Request} request - 请求对象
 * @param {number} timeout - 超时时间（毫秒），0 表示不限制
 * @returns {Promise<Response>} 响应对象
 */
async function fetchWithTimeout(request, timeout) {
	if (!timeout || timeout <= 0) {
		return fetch(request);
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		return await fetch(request, { signal: controller.signal });
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * 确保 URL 带有协议
 * @param {string} url - 要检查的 URL 字符串
 * @param {string} defaultProtocol - 默认协议（如 "https:"）
 * @returns {string} 带有协议的 URL 字符串
 */
function ensureProtocol(url, defaultProtocol) {
	return url.startsWith('http://') || url.startsWith('https://')
		? url
		: defaultProtocol + '//' + url;
}

/**
 * 处理重定向响应
 * @param {Response} response - 原始响应对象
 * @param {string} actualUrlStr - 当前代理的实际 URL（用于解析相对路径）
 * @returns {Response} 修改后的重定向响应
 */
function handleRedirect(response, actualUrlStr) {
	const location = response.headers.get('location');

	// 如果没有 Location 头，直接返回原始响应
	if (!location) {
		return new Response(null, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers
		});
	}

	let modifiedLocation;
	try {
		// 使用 actualUrlStr 作为 base URL，支持相对路径重定向
		const absoluteUrl = new URL(location, actualUrlStr);
		modifiedLocation = '/' + encodeURIComponent(absoluteUrl.toString());
	} catch {
		// 如果解析失败，直接编码原始 location
		modifiedLocation = '/' + encodeURIComponent(location);
	}

	// 构建新的响应头，排除原有的 location（会被覆盖）
	const newHeaders = new Headers(response.headers);
	newHeaders.set('Location', modifiedLocation);

	return new Response(null, {
		status: response.status,
		statusText: response.statusText,
		headers: newHeaders
	});
}

/**
 * 处理 HTML 内容中的相对路径
 * @param {string} text - HTML 文本
 * @param {string} protocol - 当前代理的协议（如 "https:"）
 * @param {string} host - 当前代理的主机名
 * @param {string} actualUrlStr - 实际的目标 URL 字符串
 * @returns {string} 处理后的 HTML 文本
 */
function handleHtmlContent(text, protocol, host, actualUrlStr) {
	const targetOrigin = new URL(actualUrlStr).origin;
	const protocolName = protocol.replace(':', '');

	// scope 类型到标签和属性的映射
	const scopeConfig = {
		link: { tag: 'a', attr: 'href' },
		style: { tag: 'link', attr: 'href' },
		script: { tag: 'script', attr: 'src' },
		image: { tag: 'img', attr: 'src' },
		media: { tag: '(?:video|audio)', attr: 'src' },
		iframe: { tag: 'iframe', attr: 'src' },
		form: { tag: 'form', attr: 'action' }
	};

	// 获取配置
	const scope = CONFIG.htmlPathRewriteScope;

	// 如果是 false 或空数组，直接返回
	if (!scope) {
		return text;
	}

	// 统一的替换处理函数
	const processUrl = (htmlText, attrName, tagPattern = null) => {
		// 相对路径处理
		const relativeRegex = tagPattern
			? new RegExp(`(<${tagPattern}[^>]*\\s+)${attrName}=["\'](\\/[^"\']*)["']`, 'gi')
			: new RegExp(`(\\s+)${attrName}=["\'](\\/[^"\']*)["']`, 'g');

		htmlText = htmlText.replace(relativeRegex, (match, spaceOrPrefix, path) => {
			if (path && path.includes(host)) {
				return match;
			}
			const encodedTarget = encodeURIComponent(targetOrigin);
			return `${spaceOrPrefix}${attrName}="${protocolName}://${host}/${encodedTarget}${path}"`;
		});

		// 绝对路径处理
		const absoluteRegex = tagPattern
			? new RegExp(
					`(<${tagPattern}[^>]*\\s+)${attrName}=["\']((?:https?:)?\\/\\/[^"\']*)["\']`,
					'gi'
				)
			: new RegExp(`(\\s+)${attrName}=["\']((?:https?:)?\\/\\/[^"\']*)["\']`, 'g');

		htmlText = htmlText.replace(absoluteRegex, (match, spaceOrPrefix, url) => {
			if (url && (url.startsWith(`https://${host}/`) || url.startsWith(`http://${host}/`))) {
				return match;
			}
			let fullUrl = url;
			if (!url.startsWith('http://') && !url.startsWith('https://')) {
				fullUrl = 'https:' + url;
			}
			const encodedUrl = encodeURIComponent(fullUrl);
			return `${spaceOrPrefix}${attrName}="${protocolName}://${host}/${encodedUrl}"`;
		});

		// 其他相对路径处理（不以 /、http://、https://、//、data:、javascript:、mailto:、# 开头）
		const otherRegex = tagPattern
			? new RegExp(
					`(<${tagPattern}[^>]*\\s+)${attrName}=["\'](?!\\/|https?:\\/\\/|\\/\\/|data:|javascript:|mailto:|#)([^"\']+)["\']`,
					'gi'
				)
			: new RegExp(
					`(\\s+)${attrName}=["\'](?!\\/|https?:\\/\\/|\\/\\/|data:|javascript:|mailto:|#)([^"\']+)["\']`,
					'g'
				);

		htmlText = htmlText.replace(otherRegex, (match, spaceOrPrefix, path) => {
			if (path && path.includes(host)) {
				return match;
			}
			let fullUrl;
			if (actualUrlStr.endsWith('/')) {
				fullUrl = actualUrlStr + path;
			} else {
				fullUrl = actualUrlStr + '/' + path;
			}
			const encodedUrl = encodeURIComponent(fullUrl);
			return `${spaceOrPrefix}${attrName}="${protocolName}://${host}/${encodedUrl}"`;
		});

		return htmlText;
	};

	// 处理数组形式
	let scopesToProcess = [];

	// 处理 'all' 的情况 - 不限制标签，处理所有 src 和 href 属性
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

	// 收集需要处理的属性（去重）
	const attrsToProcess = [
		...new Set(scopesToProcess.map((s) => scopeConfig[s]?.attr).filter(Boolean))
	];

	// 处理每种属性
	attrsToProcess.forEach((attr) => {
		// 收集需要处理的标签
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
 * 返回 JSON 格式的响应
 * @param {any} data - 要返回的数据对象
 * @param {number} status - HTTP 状态码
 * @returns {Response} JSON 响应对象
 */
function jsonResponse(data, status) {
	return new Response(JSON.stringify(data), {
		status: status,
		headers: { 'Content-Type': 'application/json; charset=utf-8' }
	});
}

/**
 * 过滤请求头
 * @param {Headers} headers - 原始请求头对象
 * @param {Function} filterFunc - 过滤函数，接收请求头名称，返回是否保留
 * @returns {Headers} 过滤后的请求头对象
 */
function filterHeaders(headers, filterFunc) {
	return new Headers([...headers].filter(([name]) => filterFunc(name)));
}

/**
 * 设置禁用缓存的头部
 * @param {Headers} headers - 要设置头的 Headers 对象
 */
function setNoCacheHeaders(headers) {
	if (CONFIG.disableCache) {
		headers.set('Cache-Control', 'no-store');
	}
}

/**
 * 设置 CORS 头部
 * @param {Headers} headers - 要设置头的 Headers 对象
 */
function setCorsHeaders(headers) {
	headers.set('Access-Control-Allow-Origin', '*');
	headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, HEAD, OPTIONS, PATCH');
	headers.set('Access-Control-Allow-Headers', '*');
}

/**
 * 检查是否有指定方向的替换规则
 * @param {string} direction - 方向：'request' 或 'response'
 * @returns {boolean} 是否有匹配的规则
 */
function hasReplaceRule(direction) {
	return CONFIG.replaceRules.some(
		(rule) => rule.direction === direction || rule.direction === 'both'
	);
}

/**
 * 检查内容类型是否为文本类型（可以进行替换）
 * @param {string} direction - 方向：'request' 或 'response'
 * @param {Request|Response} object - 请求或响应对象
 * @returns {boolean} 是否为文本类型
 */
function isTextContentType(direction, object) {
	const contentType = object.headers?.get('Content-Type') || '';
	const textTypes = [
		'text/',
		'application/json',
		'application/javascript',
		'application/xml',
		'application/vnd.api+json'
	];
	return textTypes.some((type) => contentType.includes(type));
}

/**
 * 替换请求体内容
 * @param {Request} request - 原始请求对象
 * @param {string} actualUrlStr - 当前实际请求的 URL
 * @returns {Promise<Request>} 替换后的请求对象
 */
async function replaceRequestBody(request, actualUrlStr) {
	try {
		// 检查是否为文本类型
		if (!isTextContentType('request', request)) {
			return request;
		}

		const text = await request.text();
		const modifiedText = applyReplaceRules(text, 'request', actualUrlStr);

		// 如果是 JSON，验证替换后是否仍为有效 JSON
		const contentType = request.headers.get('Content-Type') || '';
		if (contentType.includes('application/json')) {
			try {
				JSON.parse(modifiedText);
			} catch (e) {
				// JSON 无效，返回原始请求
				return request;
			}
		}

		return new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: modifiedText,
			redirect: 'manual'
		});
	} catch (e) {
		// 如果无法读取请求体（如流式请求），返回原始请求
		return request;
	}
}

/**
 * 替换响应体内容
 * @param {ReadableStream} body - 响应体流
 * @param {Response} response - 原始响应对象
 * @param {string} actualUrlStr - 当前实际请求的 URL
 * @returns {Promise<ReadableStream>} 替换后的响应体流
 */
async function replaceResponseBody(body, response, actualUrlStr) {
	try {
		// 检查是否为文本类型
		if (!isTextContentType('response', response)) {
			return body;
		}

		const text = await new Response(body).text();
		const modifiedText = applyReplaceRules(text, 'response', actualUrlStr);

		// 如果是 JSON，验证替换后是否仍为有效 JSON
		const contentType = response.headers.get('Content-Type') || '';
		if (contentType.includes('application/json')) {
			try {
				JSON.parse(modifiedText);
			} catch (e) {
				// JSON 无效，返回原始响应内容
				return new Response(text).body;
			}
		}

		// 将字符串转换回 ReadableStream
		return new Response(modifiedText).body;
	} catch (e) {
		// 如果无法处理，返回原始流
		return body;
	}
}

/**
 * 应用替换规则
 * @param {string} text - 原始文本
 * @param {string} direction - 方向：'request' 或 'response'
 * @param {string} actualUrlStr - 当前实际请求的 URL
 * @returns {string} 替换后的文本
 */
function applyReplaceRules(text, direction, actualUrlStr) {
	let urlHost = '';
	try {
		if (actualUrlStr) {
			urlHost = new URL(actualUrlStr).host;
		}
	} catch (e) {
		// 解析失败，忽略
	}

	const rules = CONFIG.replaceRules.filter(
		(rule) => rule.direction === direction || rule.direction === 'both'
	);

	for (const rule of rules) {
		const { type, pattern, replacement, jsonMode, flags, host } = rule;

		if (!pattern || replacement === undefined) {
			continue;
		}

		// 如果规则配置了 host 且不匹配当前请求的目标 host，则跳过
		if (host && urlHost) {
			let isMatch = false;
			if (host.includes('*')) {
				const regexPattern = host.replace(/\./g, '\\.').replace(/\*/g, '.*');
				const regex = new RegExp(`^${regexPattern}$`, 'i');
				isMatch = regex.test(urlHost);
			} else {
				// 支持模糊匹配（包含该字符串）
				isMatch = urlHost.toLowerCase().includes(host.toLowerCase());
			}

			if (!isMatch) {
				continue;
			}
		}

		// 如果是 JSON 模式且 jsonMode 为 keyValue
		if (jsonMode === 'keyValue' && isJsonString(text)) {
			try {
				text = applyJsonReplace(text, type, pattern, replacement, flags);
				continue;
			} catch (e) {
				// JSON 解析失败，回退到普通替换
			}
		}

		switch (type) {
			case 'regex':
				try {
					const regexFlags = flags || 'g';
					const regex = new RegExp(pattern, regexFlags);
					text = text.replace(regex, replacement);
				} catch (e) {
					// 正则表达式无效，跳过此规则
				}
				break;
			case 'exact':
				text = text.split(pattern).join(replacement);
				break;
			case 'replace':
			default:
				// replace 模式也支持 flags（如 'gi' 不区分大小写）
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
 * @param {string} flags - 正则标志（可选）
 * @returns {string} 替换后的 JSON 字符串
 */
function applyJsonReplace(jsonText, type, pattern, replacement, flags) {
	const parsed = JSON.parse(jsonText);

	/**
	 * 递归遍历 JSON 对象并替换
	 * @param {any} obj - JSON 对象
	 * @returns {any} 处理后的对象
	 */
	function traverse(obj) {
		if (Array.isArray(obj)) {
			return obj.map((item) => traverse(item));
		} else if (obj !== null && typeof obj === 'object') {
			const result = {};
			for (const [key, value] of Object.entries(obj)) {
				let newKey = key;
				let newValue = value;

				// 替换 key
				newKey = applyReplace(key, type, pattern, replacement, flags);

				// 递归处理 value
				newValue = traverse(value);

				result[newKey] = newValue;
			}
			return result;
		} else if (typeof obj === 'string') {
			// 替换字符串值
			return applyReplace(obj, type, pattern, replacement, flags);
		}
		return obj;
	}

	/**
	 * 执行单个替换
	 * @param {string} str - 要替换的字符串
	 * @param {string} type - 替换类型
	 * @param {string} pattern - 模式
	 * @param {string} replacement - 替换内容
	 * @param {string} flags - 正则标志
	 * @returns {string} 替换后的字符串
	 */
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
				// replace 模式支持不区分大小写
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
