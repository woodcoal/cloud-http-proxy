/**
 * worker.js - Cloudflare Worker 代理服务
 * 功能：作为反向代理，代理任意 URL 请求并处理 HTML 内容中的相对路径
 *
 * ⚠️ 免责声明：本项目仅供学习和技术研究使用，请勿用于任何违法、违规或破坏性用途。因滥用本项目导致的任何法律责任，由使用者自行承担。
 */

import CONFIG from './config.js';

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
		// 检查请求方法是否在白名单中
		if (!isMethodAllowed(request.method)) {
			return jsonResponse(
				{
					error: `不支持的请求方法: ${request.method}`
				},
				405
			);
		}

		// 检查请求体大小
		if (!isRequestBodySizeAllowed(request)) {
			return jsonResponse(
				{
					error: '请求体过大'
				},
				413
			);
		}

		const url = new URL(request.url);

		// 如果访问根目录，返回自定义响应
		if (url.pathname === '/') {
			return handleHomePage();
		}

		// 从请求路径中提取目标 URL
		let actualUrlStr = decodeURIComponent(url.pathname.replace('/', ''));

		// 判断用户输入的 URL 是否带有协议
		actualUrlStr = ensureProtocol(actualUrlStr, url.protocol);

		// 保留查询参数
		actualUrlStr += url.search;

		// 检查 URL 是否在白名单/黑名单中
		if (!isUrlAllowed(actualUrlStr)) {
			return jsonResponse(
				{
					error: '该地址不允许访问'
				},
				403
			);
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
			finalRequest = await replaceRequestBody(modifiedRequest);
		}

		// 发起对目标 URL 的请求（支持超时）
		const response = await fetchWithTimeout(finalRequest, CONFIG.timeout);

		// 处理重定向
		if ([301, 302, 303, 307, 308].includes(response.status)) {
			return handleRedirect(response, actualUrlStr);
		}

		// 处理 HTML 内容中的相对路径（需要先读取 body）
		let body = response.body;
		if (
			CONFIG.enableHtmlPathRewrite &&
			response.headers.get('Content-Type')?.includes('text/html')
		) {
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
			body = await replaceResponseBody(body, response);
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
			return jsonResponse(
				{
					error: '请求超时'
				},
				504
			);
		}

		// 如果请求目标地址时出现错误，返回带有错误消息的响应和状态码 500（服务器错误）
		return jsonResponse(
			{
				error: error.message
			},
			500
		);
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
 * @returns {boolean} 是否允许
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

	// 处理相对路径（以 / 开头，但不是 // 开头）
	// 例如：href="/css/style.css" → href="https://proxy.com/https%3A%2F%2Fexample.com/css/style.css"
	const relativeRegex = /((href|src|action)=["\'])(\/[^"']*)/g;
	text = text.replace(relativeRegex, (match, prefix, attr, path) => {
		const encodedTarget = encodeURIComponent(targetOrigin);
		return `${prefix}${protocolName}//${host}/${encodedTarget}${path}`;
	});

	// 处理绝对路径（完整的 URL，以 http:// 或 https:// 开头）
	// 例如：href="https://www.xxx.com/xxx" → href="https://proxy.com/https%3A%2F%2Fwww.xxx.com/xxx"
	const absoluteRegex = /((href|src|action)=["\'])((?:https?:)?\/\/[^"']*)/g;
	text = text.replace(absoluteRegex, (match, prefix, attr, url) => {
		// 确保 URL 有协议
		let fullUrl = url;
		if (!url.startsWith('http://') && !url.startsWith('https://')) {
			fullUrl = 'https:' + url;
		}
		const encodedUrl = encodeURIComponent(fullUrl);
		return `${prefix}${protocolName}//${host}/${encodedUrl}`;
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
		headers: {
			'Content-Type': 'application/json; charset=utf-8'
		}
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
 * @returns {Promise<Request>} 替换后的请求对象
 */
async function replaceRequestBody(request) {
	try {
		// 检查是否为文本类型
		if (!isTextContentType('request', request)) {
			return request;
		}

		const text = await request.text();
		const modifiedText = applyReplaceRules(text, 'request');

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
 * @returns {Promise<ReadableStream>} 替换后的响应体流
 */
async function replaceResponseBody(body, response) {
	try {
		// 检查是否为文本类型
		if (!isTextContentType('response', response)) {
			return body;
		}

		const text = await new Response(body).text();
		const modifiedText = applyReplaceRules(text, 'response');

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
 * @returns {string} 替换后的文本
 */
function applyReplaceRules(text, direction) {
	const rules = CONFIG.replaceRules.filter(
		(rule) => rule.direction === direction || rule.direction === 'both'
	);

	for (const rule of rules) {
		const { type, pattern, replacement, jsonMode } = rule;

		if (!pattern || replacement === undefined) {
			continue;
		}

		// 如果是 JSON 模式且 jsonMode 为 keyValue
		if (jsonMode === 'keyValue' && isJsonString(text)) {
			try {
				text = applyJsonReplace(text, type, pattern, replacement);
				continue;
			} catch (e) {
				// JSON 解析失败，回退到普通替换
			}
		}

		switch (type) {
			case 'regex':
				try {
					const regex = new RegExp(pattern, 'g');
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
				text = text.split(pattern).join(replacement);
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
 * @returns {string} 替换后的 JSON 字符串
 */
function applyJsonReplace(jsonText, type, pattern, replacement) {
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
				newKey = applyReplace(key, type, pattern, replacement);

				// 递归处理 value
				newValue = traverse(value);

				result[newKey] = newValue;
			}
			return result;
		} else if (typeof obj === 'string') {
			// 替换字符串值
			return applyReplace(obj, type, pattern, replacement);
		}
		return obj;
	}

	/**
	 * 执行单个替换
	 * @param {string} str - 要替换的字符串
	 * @param {string} type - 替换类型
	 * @param {string} pattern - 模式
	 * @param {string} replacement - 替换内容
	 * @returns {string} 替换后的字符串
	 */
	function applyReplace(str, type, pattern, replacement) {
		switch (type) {
			case 'regex':
				try {
					const regex = new RegExp(pattern, 'g');
					return str.replace(regex, replacement);
				} catch (e) {
					return str;
				}
			case 'exact':
			case 'replace':
			default:
				return str.split(pattern).join(replacement);
		}
	}

	const result = traverse(parsed);
	return JSON.stringify(result);
}
