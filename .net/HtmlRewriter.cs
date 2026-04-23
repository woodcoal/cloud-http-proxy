using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace CloudHttpProxy;

/**
 * 类名称：HtmlRewriter
 * 功能描述：HTML 内容重写工具，用于将代理返回的 HTML 中的资源路径重写为经过代理转发的相对或绝对路径，避免静态资源加载失败。
 */
public static class HtmlRewriter
{
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
     * @param scope - 需要处理的标签范围列表（如 ["link", "script"] 或 ["all"]）
     * @returns 返回重写后的 HTML 字符串
     */
    public static string RewriteHtml(string htmlText, string protocol, string host, string targetOrigin, List<string>? scope)
    {
        if (scope == null || scope.Count == 0 || string.IsNullOrWhiteSpace(htmlText)) 
            return htmlText;

        bool processAll = scope.Contains("all", StringComparer.OrdinalIgnoreCase);
        var attrsToProcess = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        
        // 确定需要处理的 HTML 属性
        if (processAll)
        {
            attrsToProcess.Add("href");
            attrsToProcess.Add("src");
            attrsToProcess.Add("action");
        }
        else
        {
            foreach (var s in scope)
            {
                if (ScopeConfig.TryGetValue(s, out var config))
                {
                    attrsToProcess.Add(config.Attr);
                }
            }
        }

        // 根据确定的属性处理替换逻辑
        foreach (var attr in attrsToProcess)
        {
            var tags = processAll 
                ? new List<string?> { null }
                : scope.Where(s => ScopeConfig.ContainsKey(s) && ScopeConfig[s].Attr.Equals(attr, StringComparison.OrdinalIgnoreCase))
                       .Select(s => ScopeConfig[s].Tag)
                       .Distinct()
                       .Select(t => (string?)t)
                       .ToList();

            foreach (var tag in tags)
            {
                htmlText = ProcessUrl(htmlText, attr, tag, protocol, host, targetOrigin);
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
     * @returns 替换完成后的 HTML
     */
    private static string ProcessUrl(string htmlText, string attrName, string? tagPattern, string protocol, string host, string targetOrigin)
    {
        string encodedTarget = Uri.EscapeDataString(targetOrigin);
        string protocolName = protocol.Replace(":", ""); // 提取纯协议名

        // 1. 处理相对路径 (例如 src="/js/app.js")
        string relRegexStr = tagPattern != null
            ? $"(<{tagPattern}[^>]*\\s+{attrName}=)[\"'](\\/[^\"']*)[\"']"
            : $"(\\s+{attrName}=)[\"'](\\/[^\"']*)[\"']";
        
        htmlText = Regex.Replace(htmlText, relRegexStr, match => 
        {
            string prefix = match.Groups[1].Value;
            string path = match.Groups[2].Value;
            
            // 如果已经是当前代理的相对路径，不再转换
            if (path.Contains(host, StringComparison.OrdinalIgnoreCase)) return match.Value;
            
            // 将原始相对路径替换为指向代理服务器的编码后路径
            return $"{prefix}\"{protocolName}://{host}/{encodedTarget}{path}\"";
        }, RegexOptions.IgnoreCase);

        // 2. 处理绝对路径 (例如 src="https://example.com/js/app.js")
        string absRegexStr = tagPattern != null
            ? $"(<{tagPattern}[^>]*\\s+{attrName}=)[\"']((?:https?:)?\\/\\/[^\"']*)[\"']"
            : $"(\\s+{attrName}=)[\"']((?:https?:)?\\/\\/[^\"']*)[\"']";
            
        htmlText = Regex.Replace(htmlText, absRegexStr, match => 
        {
            string prefix = match.Groups[1].Value;
            string url = match.Groups[2].Value;
            
            // 如果目标地址已经是代理域名下的地址，跳过
            if (url.StartsWith($"https://{host}/", StringComparison.OrdinalIgnoreCase) || 
                url.StartsWith($"http://{host}/", StringComparison.OrdinalIgnoreCase))
                return match.Value;
                
            // 补全协议头
            string fullUrl = url;
            if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && 
                !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                fullUrl = "https:" + url;
                
            // 将整个绝对路径编码并拼接在代理路径后
            string encodedUrl = Uri.EscapeDataString(fullUrl);
            return $"{prefix}\"{protocolName}://{host}/{encodedUrl}\"";
        }, RegexOptions.IgnoreCase);

        return htmlText;
    }
}
