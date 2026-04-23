using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace CloudHttpProxy;

/**
 * 类名称：IpUtils
 * 功能描述：提供 IP 地址验证和匹配相关的实用工具方法，支持精确匹配、通配符匹配和 CIDR 掩码匹配
 */
public static class IpUtils {
	/**
     * 函数名称：IsIpAllowed
     * 功能描述：检查指定的客户端 IP 是否存在于允许的白名单中
     * 
     * @param clientIp - 需要检查的客户端 IP 地址字符串
     * @param whitelist - 允许的 IP 白名单列表（包含具体 IP、通配符或 CIDR）
     * @returns 如果白名单为空则默认允许返回 true；如果 IP 在白名单中返回 true；否则返回 false
     * 
     * 注意事项：
     * - 当 clientIp 为空或 "unknown" 时，会直接返回 false
     */
	public static bool IsIpAllowed(string clientIp, List<string>? whitelist) {
		// 如果白名单未配置或为空，则默认允许所有 IP 访问
		if (whitelist == null || whitelist.Count == 0) {
			return true;
		}

		// 无法获取到有效 IP，拒绝访问
		if (string.IsNullOrEmpty(clientIp) || clientIp == "unknown") {
			return false;
		}

		foreach (var pattern in whitelist) {
			if (MatchIpPattern(clientIp, pattern)) {
				return true;
			}
		}
		return false;
	}

	/**
     * 函数名称：MatchIpPattern
     * 功能描述：将客户端 IP 与单个匹配模式进行比较
     * 
     * @param clientIp - 客户端 IP
     * @param pattern - 匹配模式（可为具体 IP、含 * 的通配符、或 CIDR 格式如 192.168.1.0/24）
     * @returns 如果匹配成功返回 true，否则返回 false
     */
	private static bool MatchIpPattern(string clientIp, string pattern) {
		// 1. 精确匹配
		if (clientIp == pattern) {
			return true;
		}

		// 2. 通配符匹配 (例如 192.168.1.*)
		if (pattern.Contains('*')) {
			var regexPattern = "^" + Regex.Escape(pattern).Replace("\\*", ".*") + "$";
			return Regex.IsMatch(clientIp, regexPattern);
		}

		// 3. CIDR 掩码匹配 (例如 192.168.1.0/24)
		if (pattern.Contains('/')) {
			return CidrMatch(clientIp, pattern);
		}

		return false;
	}

	/**
     * 函数名称：CidrMatch
     * 功能描述：检查 IP 是否属于指定的 CIDR 网段
     * 
     * @param ipStr - 要检查的 IP 地址
     * @param cidr - CIDR 格式的网络地址（例如 10.0.0.0/8）
     * @returns 如果属于该网段返回 true，否则返回 false
     */
	private static bool CidrMatch(string ipStr, string cidr) {
		try {
			var parts = cidr.Split('/');
			if (parts.Length != 2) {
				return false;
			}

			if (!IPAddress.TryParse(parts[0], out var network) || !IPAddress.TryParse(ipStr, out var ip)) {
				return false;
			}

			if (!int.TryParse(parts[1], out var maskLen)) {
				return false;
			}

			// IPv4 和 IPv6 必须对应才能比较
			if (network.AddressFamily != ip.AddressFamily) {
				return false;
			}

			var ipBytes = ip.GetAddressBytes();
			var netBytes = network.GetAddressBytes();

			// 逐字节比对掩码长度范围内的位
			for (var i = 0; i < ipBytes.Length; i++) {
				if (maskLen >= 8) {
					if (ipBytes[i] != netBytes[i]) {
						return false;
					}

					maskLen -= 8;
				} else if (maskLen > 0) {
					var mask = 0xFF << (8 - maskLen);
					if ((ipBytes[i] & mask) != (netBytes[i] & mask)) {
						return false;
					}

					maskLen = 0;
				}
			}
			return true;
		} catch {
			// 解析异常时保守返回 false
			return false;
		}
	}
}

/**
 * 类名称：HtmlRewriter
 * 功能描述：HTML 内容重写工具，用于将代理返回的 HTML 中的资源路径重写为经过代理转发的相对或绝对路径，避免静态资源加载失败。
 */
public static class HtmlRewriter {
	// 配置支持的 HTML 标签及属性名称对应关系
	private static readonly Dictionary<string, (string Tag, string Attr)> ScopeConfig = new(StringComparer.OrdinalIgnoreCase)
	{
		{ "link", ("a", "href") },
		{ "style", ("link", "href") },
		{ "script", ("script", "src") },
		{ "image", ("img", "src") },
		{ "media", ("(?:video|audio)", "src") },
		{ "iframe", ("iframe", "src") },
		{ "form", ("form", "action") }
	};

	/**
	* 函数名称：RewriteHtml
	* 功能描述：对 HTML 文本中的资源链接进行重写替换
	*
	* @param htmlText - 原始 HTML 文本
	* @param protocol - 当前请求协议 (如 "http" 或 "https")
	* @param host - 当前代理服务器的 Host
	* @param targetOrigin - 目标服务器的 Origin 根地址
	* @param actualUrlStr - 当前实际访问地址
	* @param scope - 需要处理的标签范围列表（如 ["link", "script"] 或 ["all"]）
	* @returns 返回重写后的 HTML 字符串
	*/
	public static string RewriteHtml(string htmlText, string protocol, string host, string targetOrigin, string actualUrlStr, List<string>? scope) {
		if (scope == null || scope.Count == 0 || string.IsNullOrWhiteSpace(htmlText)) {
			return htmlText;
		}

		var processAll = scope.Contains("all", StringComparer.OrdinalIgnoreCase);
		var attrsToProcess = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

		// 确定需要处理的 HTML 属性
		if (processAll) {
			attrsToProcess.Add("href");
			attrsToProcess.Add("src");
			attrsToProcess.Add("action");
		} else {
			foreach (var s in scope) {
				if (ScopeConfig.TryGetValue(s, out var config)) {
					attrsToProcess.Add(config.Attr);
				}
			}
		}

		// 根据确定的属性处理替换逻辑
		foreach (var attr in attrsToProcess) {
			var tags = processAll
				? [null]
				: scope.Where(s => ScopeConfig.ContainsKey(s) && ScopeConfig[s].Attr.Equals(attr, StringComparison.OrdinalIgnoreCase))
					   .Select(s => ScopeConfig[s].Tag)
					   .Distinct()
					   .Select(t => (string?) t)
					   .ToList();

			foreach (var tag in tags) {
				htmlText = ProcessUrl(htmlText, attr, tag, protocol, host, targetOrigin, actualUrlStr);
			}
		}

		return htmlText;
	}

	/**
	* 函数名称：ProcessUrl
	* 功能描述：使用正则表达式匹配并替换具体的 HTML 标签属性路径
	* 
	* @param htmlText - 待处理的 HTML
	* @param attrName - 要匹配的属性名称 (如 "src" 或 "href")
	* @param tagPattern - 要匹配的标签名称的正则表示式 (为 null 时匹配所有包含对应属性的标签)
	* @param protocol - 代理服务器协议
	* @param host - 代理服务器域名
	* @param targetOrigin - 目标网站原始地址
	* @param actualUrlStr - 当前实际访问地址
	* @returns 替换完成后的 HTML
	*/
	private static string ProcessUrl(string htmlText, string attrName, string? tagPattern, string protocol, string host, string targetOrigin, string actualUrlStr) {
		var encodedTarget = Uri.EscapeDataString(targetOrigin);
		var protocolName = protocol.Replace(":", ""); // 提取纯协议名

		// 1. 处理相对路径 (例如 src="/js/app.js")
		var relRegexStr = tagPattern != null
			? $"(<{tagPattern}[^>]*\\s+){attrName}=[\"'](\\/[^\"']*)[\"']"
			: $"(\\s+){attrName}=[\"'](\\/[^\"']*)[\"']";

		htmlText = Regex.Replace(htmlText, relRegexStr, match => {
			var prefix = match.Groups[1].Value;
			var path = match.Groups[2].Value;

			// 如果已经是当前代理的相对路径，不再转换
			if (path.Contains(host, StringComparison.OrdinalIgnoreCase)) {
				return match.Value;
			}

			// 将原始相对路径替换为指向代理服务器的编码后路径
			return $"{prefix}{attrName}=\"{protocolName}://{host}/{encodedTarget}{path}\"";
		}, RegexOptions.IgnoreCase);

		// 2. 处理绝对路径 (例如 src="https://example.com/js/app.js")
		var absRegexStr = tagPattern != null
			? $"(<{tagPattern}[^>]*\\s+){attrName}=[\"']((?:https?:)?\\/\\/[^\"']*)[\"']"
			: $"(\\s+){attrName}=[\"']((?:https?:)?\\/\\/[^\"']*)[\"']";

		htmlText = Regex.Replace(htmlText, absRegexStr, match => {
			var prefix = match.Groups[1].Value;
			var url = match.Groups[2].Value;

			// 如果目标地址已经是代理域名下的地址，跳过
			if (url.StartsWith($"https://{host}/", StringComparison.OrdinalIgnoreCase) ||
				url.StartsWith($"http://{host}/", StringComparison.OrdinalIgnoreCase)) {
				return match.Value;
			}

			// 补全协议头
			var fullUrl = url;
			if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
				!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) {
				fullUrl = "https:" + url;
			}

			// 将整个绝对路径编码并拼接在代理路径后
			var encodedUrl = Uri.EscapeDataString(fullUrl);
			return $"{prefix}{attrName}=\"{protocolName}://{host}/{encodedUrl}\"";
		}, RegexOptions.IgnoreCase);

		// 3. 处理其他路径 (非 /、http://、https://、//、data:、javascript:、mailto:、# 开头)
		var otherRegexStr = tagPattern != null
			? $"(<{tagPattern}[^>]*\\s+){attrName}=[\"'](?!\\/|https?:\\/\\/|\\/\\/|data:|javascript:|mailto:|#)([^\"']+)[\"']"
			: $"(\\s+){attrName}=[\"'](?!\\/|https?:\\/\\/|\\/\\/|data:|javascript:|mailto:|#)([^\"']+)[\"']";

		htmlText = Regex.Replace(htmlText, otherRegexStr, match => {
			var prefix = match.Groups[1].Value;
			var path = match.Groups[2].Value;

			if (path.Contains(host, StringComparison.OrdinalIgnoreCase)) {
				return match.Value;
			}

			var fullUrl = actualUrlStr.EndsWith("/") ? actualUrlStr + path : actualUrlStr + "/" + path;
			var encodedUrl = Uri.EscapeDataString(fullUrl);
			return $"{prefix}{attrName}=\"{protocolName}://{host}/{encodedUrl}\"";
		}, RegexOptions.IgnoreCase);

		return htmlText;
	}}

/**
 * 类名称：ContentReplacer
 * 功能描述：文本与 JSON 内容的规则替换引擎，支持基于正则、普通文本和 JSON 键值对递归遍历的文本替换功能
 */
public static class ContentReplacer {
	/**
     * 函数名称：ApplyReplaceRules
     * 功能描述：应用规则列表对给定的文本内容进行替换处理
     * 
     * @param text - 待替换的原始文本或 JSON 字符串
     * @param direction - 替换方向上下文（"request" 表示请求，"response" 表示响应）
     * @param actualUrlStr - 当前实际访问的目标 URL，用于域名匹配
     * @param rules - 用户配置的替换规则列表
     * @returns 替换操作后的字符串结果
     */
	public static string ApplyReplaceRules(string text, string direction, string actualUrlStr, List<ReplaceRule>? rules) {
		if (rules == null || rules.Count == 0 || string.IsNullOrEmpty(text)) {
			return text;
		}

		var urlHost = "";
		try {
			if (!string.IsNullOrEmpty(actualUrlStr)) {
				urlHost = new Uri(actualUrlStr).Host;
			}
		} catch {
			// 解析失败，忽略
		}

		// 筛选出适用当前方向的规则
		var applicableRules = rules.Where(r =>
			string.Equals(r.Direction, direction, StringComparison.OrdinalIgnoreCase) ||
			string.Equals(r.Direction, "both", StringComparison.OrdinalIgnoreCase)
		).ToList();

		foreach (var rule in applicableRules) {
			if (string.IsNullOrEmpty(rule.Pattern) || rule.Replacement == null) {
				continue;
			}

			// 如果规则配置了 Host 且不匹配当前请求的目标 Host，则跳过
			if (!string.IsNullOrEmpty(rule.Host) && !string.IsNullOrEmpty(urlHost)) {
				bool isMatch = false;
				if (rule.Host.Contains('*')) {
					var regexPattern = "^" + Regex.Escape(rule.Host).Replace("\\*", ".*") + "$";
					isMatch = Regex.IsMatch(urlHost, regexPattern, RegexOptions.IgnoreCase);
				} else {
					// 支持模糊匹配（包含该字符串）
					isMatch = urlHost.Contains(rule.Host, StringComparison.OrdinalIgnoreCase);
				}

				if (!isMatch) {
					continue;
				}
			}

			// 处理特殊模式：JSON 键值对遍历替换
			if (string.Equals(rule.JsonMode, "keyValue", StringComparison.OrdinalIgnoreCase) && IsJsonString(text)) {
				try {
					text = ApplyJsonReplace(text, rule);
					continue;
				} catch {
					// 若解析或替换过程出错，则回退为当做普通文本处理
				}
			}

			// 默认文本内容替换
			text = ApplySingleReplace(text, rule);
		}

		return text;
	}

	/**
     * 函数名称：ApplySingleReplace
     * 功能描述：应用单条规则进行字符串替换
     * 
     * @param str - 待替换字符串
     * @param rule - 替换规则配置对象
     * @returns 替换后的字符串
     */
	private static string ApplySingleReplace(string str, ReplaceRule rule) {
		if (string.IsNullOrEmpty(str)) {
			return str;
		}

		switch (rule.Type?.ToLowerInvariant()) {
			case "regex":
				try {
					var options = RegexOptions.None;
					if (rule.Flags?.Contains('i', StringComparison.OrdinalIgnoreCase) == true) {
						options |= RegexOptions.IgnoreCase;
					}

					return Regex.Replace(str, rule.Pattern, rule.Replacement, options);
				} catch { return str; } // 正则异常时安全返回原字符串

			case "exact":
				return str.Replace(rule.Pattern, rule.Replacement);

			case "replace":
			default:
				if (rule.Flags?.Contains('i', StringComparison.OrdinalIgnoreCase) == true) {
					return Regex.Replace(str, Regex.Escape(rule.Pattern), rule.Replacement, RegexOptions.IgnoreCase);
				}
				return str.Replace(rule.Pattern, rule.Replacement);
		}
	}

	/**
     * 函数名称：IsJsonString
     * 功能描述：快速检测字符串是否可能为合法的 JSON 对象或数组
     * 
     * @param str - 待检测字符串
     * @returns 判断结果（通过基本包裹特征加上尝试解析）
     */
	private static bool IsJsonString(string str) {
		if (string.IsNullOrWhiteSpace(str)) {
			return false;
		}

		str = str.Trim();

		if ((str.StartsWith("{") && str.EndsWith("}")) || (str.StartsWith("[") && str.EndsWith("]"))) {
			try {
				using var doc = JsonDocument.Parse(str);
				return true;
			} catch { return false; }
		}
		return false;
	}

	/**
     * 函数名称：ApplyJsonReplace
     * 功能描述：解析 JSON 字符串为语法树结构并递归应用替换规则
     */
	private static string ApplyJsonReplace(string jsonText, ReplaceRule rule) {
		var node = JsonNode.Parse(jsonText);
		node = Traverse(node, rule);
		return node?.ToJsonString() ?? jsonText;
	}

	/**
     * 函数名称：Traverse
     * 功能描述：递归遍历 JSON 节点并替换其内部的值与键
     * 
     * @param node - 待处理的 JSON 节点
     * @param rule - 替换规则
     * @returns 替换后的新 JSON 节点
     */
	private static JsonNode? Traverse(JsonNode? node, ReplaceRule rule) {
		if (node is JsonArray arr) {
			var newArr = new JsonArray();
			foreach (var item in arr) {
				newArr.Add(Traverse(item?.DeepClone(), rule));
			}
			return newArr;
		} else if (node is JsonObject obj) {
			var newObj = new JsonObject();
			foreach (var kvp in obj) {
				// 对 JSON 键进行替换
				var newKey = ApplySingleReplace(kvp.Key, rule);
				// 对嵌套值递归处理
				newObj[newKey] = Traverse(kvp.Value?.DeepClone(), rule);
			}
			return newObj;
		} else if (node is JsonValue val && val.TryGetValue<string>(out var strVal) && strVal != null) {
			// 仅对文本型 JSON 节点值进行替换
			return JsonValue.Create(ApplySingleReplace(strVal, rule));
		}
		return node;
	}
}