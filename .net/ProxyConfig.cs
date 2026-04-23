using System.Collections.Generic;

namespace CloudHttpProxy;

/**
 * 类名称：ProxyConfig
 * 功能描述：代理服务器的全局配置类，用于映射 appsettings.json 中的 ProxyConfig 节点
 */
public class ProxyConfig
{
    /**
     * 属性名称：BindIp
     * 功能描述：服务器绑定的 IP 地址。默认为 0.0.0.0（允许所有连接）
     */
    public string BindIp { get; set; } = "0.0.0.0";

    /**
     * 属性名称：BindPort
     * 功能描述：服务器绑定的端口。默认为 5000
     */
    public int BindPort { get; set; } = 5000;

    /**
     * 属性名称：Timeout
     * 功能描述：请求超时时间（毫秒）。默认值为 0（代表使用默认超时，例如 100秒）
     */
    public int Timeout { get; set; } = 0;

    /**
     * 属性名称：MaxRequestBodySize
     * 功能描述：允许的最大请求体大小（字节）。默认 10MB
     */
    public long MaxRequestBodySize { get; set; } = 10 * 1024 * 1024;

    /**
     * 属性名称：AllowedMethods
     * 功能描述：允许的 HTTP 请求方法列表
     */
    public List<string> AllowedMethods { get; set; } = new() { "GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH" };

    /**
     * 属性名称：ProxyToken
     * 功能描述：访问代理服务所需的鉴权 Token，通过请求头 x-proxy-key 传递
     */
    public string ProxyToken { get; set; } = "";

    /**
     * 属性名称：IpWhitelist
     * 功能描述：允许访问的 IP 白名单列表，支持具体 IP、通配符（*）和 CIDR（如 192.168.1.0/24）
     */
    public List<string> IpWhitelist { get; set; } = new();

    /**
     * 属性名称：FilteredHeaderPrefixes
     * 功能描述：需要过滤掉的请求头前缀列表（例如 Cloudflare 的 cf- 前缀）
     */
    public List<string> FilteredHeaderPrefixes { get; set; } = new() { "cf-" };

    /**
     * 属性名称：FilteredSensitiveHeaders
     * 功能描述：需要过滤掉的敏感请求头列表
     */
    public List<string> FilteredSensitiveHeaders { get; set; } = new() { "cookie", "authorization", "proxy-authorization", "proxy-authenticate", "sec-websocket-key", "sec-websocket-protocol" };

    /**
     * 属性名称：UrlAccessControl
     * 功能描述：目标 URL 的访问控制配置（黑白名单）
     */
    public UrlAccessControlConfig UrlAccessControl { get; set; } = new();

    /**
     * 属性名称：UrlShortcuts
     * 功能描述：URL 快捷方式映射，将特定的短路径映射到完整的目标 URL
     */
    public Dictionary<string, string> UrlShortcuts { get; set; } = new();

    /**
     * 属性名称：ReplaceRules
     * 功能描述：内容替换规则列表，用于对请求体或响应体进行文本/正则替换
     */
    public List<ReplaceRule> ReplaceRules { get; set; } = new();

    /**
     * 属性名称：HomePage
     * 功能描述：直接访问根路径 (/) 时的默认首页配置
     */
    public HomePageConfig HomePage { get; set; } = new();

    /**
     * 属性名称：HtmlPathRewriteScope
     * 功能描述：指定哪些 HTML 标签的路径需要被重写（如 link, script, image 等）
     */
    public List<string> HtmlPathRewriteScope { get; set; } = new() { "link", "style", "script", "image", "media", "iframe", "form" };

    /**
     * 属性名称：DisableCache
     * 功能描述：是否禁用代理缓存。如果为 true，将在响应头中加入 no-store
     */
    public bool DisableCache { get; set; } = true;
}

/**
 * 类名称：UrlAccessControlConfig
 * 功能描述：URL 访问控制配置
 */
public class UrlAccessControlConfig
{
    /**
     * 属性名称：Mode
     * 功能描述：控制模式：none（不控制）、whitelist（白名单）、blacklist（黑名单）
     */
    public string Mode { get; set; } = "none";

    /**
     * 属性名称：Urls
     * 功能描述：需要进行访问控制的 URL 或域名列表，支持通配符
     */
    public List<string> Urls { get; set; } = new();
}

/**
 * 类名称：ReplaceRule
 * 功能描述：文本或 JSON 内容的替换规则
 */
public class ReplaceRule
{
    /**
     * 属性名称：Type
     * 功能描述：匹配类型：replace（默认，不区分大小写的普通替换）、exact（精确普通替换）、regex（正则表达式替换）
     */
    public string Type { get; set; } = "replace";

    /**
     * 属性名称：Pattern
     * 功能描述：匹配的模式字符串或正则表达式
     */
    public string Pattern { get; set; } = "";

    /**
     * 属性名称：Replacement
     * 功能描述：替换后的目标字符串
     */
    public string Replacement { get; set; } = "";

    /**
     * 属性名称：Direction
     * 功能描述：生效方向：request（请求体）、response（响应体）、both（双向生效）
     */
    public string Direction { get; set; } = "both";

    /**
     * 属性名称：JsonMode
     * 功能描述：JSON 处理模式：whole（整体作为文本处理）、keyValue（逐个解析 JSON 键值对进行替换）
     */
    public string JsonMode { get; set; } = "whole";

    /**
     * 属性名称：Flags
     * 功能描述：正则表达式的修饰符（如 'i' 表示忽略大小写）
     */
    public string Flags { get; set; } = "";
}

/**
 * 类名称：HomePageConfig
 * 功能描述：代理首页配置
 */
public class HomePageConfig
{
    /**
     * 属性名称：StatusCode
     * 功能描述：访问首页时返回的 HTTP 状态码
     */
    public int? StatusCode { get; set; } = 404;

    /**
     * 属性名称：Content
     * 功能描述：访问首页时返回的 HTML 文本内容
     */
    public string Content { get; set; } = "";
}
