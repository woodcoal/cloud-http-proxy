using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Yarp.ReverseProxy.Forwarder;

namespace CloudHttpProxy;

/**
 * 类名称：ProxyMiddleware
 * 功能描述：核心的 HTTP 请求代理中间件，负责接收客户端请求，进行权限、IP 校验，重写与过滤请求/响应内容，并向目标服务器转发请求
 */
public class ProxyMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IHttpForwarder _forwarder;
    private readonly HttpMessageInvoker _httpClient;

    /**
     * 函数名称：ProxyMiddleware
     * 功能描述：构造函数，初始化并配置 HttpClient 连接池和 SSL 证书回调
     */
    public ProxyMiddleware(RequestDelegate next, IHttpForwarder forwarder)
    {
        _next = next;
        _forwarder = forwarder;
        
        // 配置底层转发使用的 HttpMessageInvoker，优化连接池与解压缩性能
        _httpClient = new HttpMessageInvoker(new SocketsHttpHandler()
        {
            AllowAutoRedirect = false, // 禁止自动重定向，由代理转发原始 3xx 状态给客户端
            AutomaticDecompression = DecompressionMethods.All,
            UseCookies = false,
            EnableMultipleHttp2Connections = true,
            PooledConnectionLifetime = TimeSpan.FromMinutes(2),
            SslOptions = new System.Net.Security.SslClientAuthenticationOptions
            {
                // 忽略无效或不受信任的目标服务器 SSL 证书
                RemoteCertificateValidationCallback = (sender, cert, chain, sslPolicyErrors) => true
            }
        });
    }

    /**
     * 函数名称：InvokeAsync
     * 功能描述：处理每个 HTTP 请求的执行入口，进行一系列的前置检查与请求代理转发
     */
    public async Task InvokeAsync(HttpContext context, IOptionsSnapshot<ProxyConfig> configSnapshot)
    {
        var config = configSnapshot.Value;

        // 1. 获取客户端 IP 进行白名单验证
        var clientIp = context.Connection.RemoteIpAddress?.ToString() ?? 
                       context.Request.Headers["X-Forwarded-For"].FirstOrDefault()?.Split(',')[0].Trim() ?? 
                       context.Request.Headers["CF-Connecting-IP"].FirstOrDefault() ?? "unknown";
        
        if (!IpUtils.IsIpAllowed(clientIp, config.IpWhitelist))
        {
            await JsonError(context, "IP 不在白名单中", 403);
            return;
        }

        // 2. 验证代理 Token
        if (!string.IsNullOrEmpty(config.ProxyToken) && 
            context.Request.Headers["x-proxy-key"].FirstOrDefault() != config.ProxyToken)
        {
            await JsonError(context, "Token 验证失败", 401);
            return;
        }

        // 3. 验证 HTTP 请求方法是否被允许
        if (config.AllowedMethods?.Count > 0 && 
            !config.AllowedMethods.Contains(context.Request.Method, StringComparer.OrdinalIgnoreCase))
        {
            await JsonError(context, $"不支持的请求方法: {context.Request.Method}", 405);
            return;
        }

        // 4. 验证请求体大小限制
        if (config.MaxRequestBodySize > 0 && context.Request.ContentLength > config.MaxRequestBodySize)
        {
            await JsonError(context, "请求体过大", 413);
            return;
        }

        // 5. 首页处理逻辑
        if (context.Request.Path == "/")
        {
            if (config.HomePage?.StatusCode != null)
            {
                context.Response.StatusCode = config.HomePage.StatusCode.Value;
                context.Response.ContentType = "text/html; charset=utf-8";
                await context.Response.WriteAsync(config.HomePage.Content ?? "");
            }
            return;
        }

        // 屏蔽浏览器自动探测代理根目录的 favicon.ico 导致的无效域名请求错误
        if (context.Request.Path.Equals("/favicon.ico", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = 404;
            return;
        }

        // 6. 解析并构造目标 URL
        string pathAndQuery = context.Request.Path.Value?.TrimStart('/') ?? "";
        string actualUrlStr = Uri.UnescapeDataString(pathAndQuery);
        bool isShortcut = false;

        var pathParts = actualUrlStr.Split('/', StringSplitOptions.RemoveEmptyEntries);
        // 如果使用了 URL 快捷短链接配置，转换它
        if (pathParts.Length > 0 && config.UrlShortcuts != null && config.UrlShortcuts.TryGetValue(pathParts[0], out var shortcutUrl))
        {
            isShortcut = true;
            var remaining = string.Join('/', pathParts.Skip(1));
            shortcutUrl = !string.IsNullOrEmpty(remaining) ? $"{shortcutUrl.TrimEnd('/')}/{remaining}" : shortcutUrl;
            actualUrlStr = EnsureProtocol(shortcutUrl, context.Request.Scheme);
        }
        else
        {
            actualUrlStr = EnsureProtocol(actualUrlStr, context.Request.Scheme);
        }

        // 拼接原本的 QueryString
        if (context.Request.QueryString.HasValue)
        {
            actualUrlStr += context.Request.QueryString.Value;
        }

        // 7. 目标 URL 访问黑白名单控制
        if (!isShortcut && !IsUrlAllowed(actualUrlStr, config.UrlAccessControl))
        {
            await JsonError(context, "该地址不允许访问", 403);
            return;
        }

        // 8. 解析最终目标地址 URI
        if (!Uri.TryCreate(actualUrlStr, UriKind.Absolute, out var targetUri))
        {
            await JsonError(context, "无效的目标地址", 400);
            return;
        }
        
        // 准备转发参数
        string destinationPrefix = $"{targetUri.Scheme}://{targetUri.Authority}";
        context.Request.Path = targetUri.AbsolutePath;
        context.Request.QueryString = new QueryString(targetUri.Query);

        // 9. 处理并替换请求体内容 (如果匹配规则方向)
        bool hasReqReplace = config.ReplaceRules?.Any(r => r.Direction == "request" || r.Direction == "both") == true;
        if (hasReqReplace && IsTextContentType(context.Request.ContentType))
        {
            using var reader = new StreamReader(context.Request.Body);
            var text = await reader.ReadToEndAsync();
            var modifiedText = ContentReplacer.ApplyReplaceRules(text, "request", config.ReplaceRules);
            
            // 如果内容为 JSON，进行格式校验以避免修改造成格式错误
            if (context.Request.ContentType?.Contains("application/json", StringComparison.OrdinalIgnoreCase) == true)
            {
                try { System.Text.Json.JsonDocument.Parse(modifiedText); }
                catch { modifiedText = text; } // 解析失败则回退原始请求体
            }
            
            var bytes = Encoding.UTF8.GetBytes(modifiedText);
            context.Request.Body = new MemoryStream(bytes);
            context.Request.ContentLength = bytes.Length;
        }

        // 10. 执行 YARP 的 HTTP 请求转发
        var forwardContext = new ForwarderRequestConfig
        {
            ActivityTimeout = config.Timeout > 0 ? TimeSpan.FromMilliseconds(config.Timeout) : TimeSpan.FromSeconds(100),
            Version = HttpVersion.Version11,
            VersionPolicy = HttpVersionPolicy.RequestVersionOrHigher
        };

        // 注入自定义变换器修改请求头和响应体
        var transformer = new CustomTransformer(config, actualUrlStr);

        var error = await _forwarder.SendAsync(context, destinationPrefix, _httpClient, forwardContext, transformer);

        // 处理代理发生的内部错误
        if (error != ForwarderError.None && !context.Response.HasStarted)
        {
            var errorFeature = context.Features.Get<IForwarderErrorFeature>();
            if (errorFeature?.Exception is TaskCanceledException || errorFeature?.Exception is TimeoutException)
            {
                await JsonError(context, "请求超时", 504);
            }
            else
            {
                await JsonError(context, errorFeature?.Exception?.Message ?? "Server Error", 500);
            }
        }
    }

    /**
     * 函数名称：EnsureProtocol
     * 功能描述：确保 URL 包含协议头，未包含时使用当前请求的默认协议补充
     */
    private string EnsureProtocol(string url, string defaultScheme)
    {
        return url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || 
               url.StartsWith("https://", StringComparison.OrdinalIgnoreCase) 
               ? url : $"{defaultScheme}://{url}";
    }

    /**
     * 函数名称：IsUrlAllowed
     * 功能描述：检查访问的目标 URL 是否满足访问控制的配置规则（黑白名单校验）
     */
    private bool IsUrlAllowed(string urlStr, UrlAccessControlConfig? ctrl)
    {
        if (ctrl == null || string.Equals(ctrl.Mode, "none", StringComparison.OrdinalIgnoreCase) || ctrl.Urls == null || ctrl.Urls.Count == 0) 
            return true;
        
        try
        {
            var url = new Uri(urlStr);
            foreach (var pattern in ctrl.Urls)
            {
                bool isMatch = false;
                try
                {
                    if (pattern.Contains('*'))
                    {
                        string regexPattern = "^" + Regex.Escape(pattern).Replace("\\*", ".*") + "$";
                        isMatch = Regex.IsMatch(url.Host, regexPattern, RegexOptions.IgnoreCase) || 
                                  Regex.IsMatch(url.ToString(), regexPattern, RegexOptions.IgnoreCase);
                    }
                    else
                    {
                        var patternUri = new Uri(pattern.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? pattern : "https://" + pattern);
                        if (patternUri.GetLeftPart(UriPartial.Authority) == url.GetLeftPart(UriPartial.Authority))
                        {
                            isMatch = patternUri.AbsolutePath == "/" || 
                                      url.AbsolutePath.StartsWith(patternUri.AbsolutePath, StringComparison.OrdinalIgnoreCase);
                        }
                    }
                }
                catch { isMatch = url.Host.Contains(pattern) || url.ToString().Contains(pattern); }

                // 白名单模式：一旦匹配则通过；黑名单模式：一旦匹配则拦截
                if (isMatch) return string.Equals(ctrl.Mode, "whitelist", StringComparison.OrdinalIgnoreCase);
            }
            // 循环结束未匹配的：白名单默认拒绝，黑名单默认通过
            return !string.Equals(ctrl.Mode, "whitelist", StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; } // 解析报错一律拦截
    }

    /**
     * 函数名称：IsTextContentType
     * 功能描述：判断 Content-Type 是否属于可以通过字符串读取和替换的文本类型
     */
    private bool IsTextContentType(string? contentType)
    {
        if (string.IsNullOrEmpty(contentType)) return false;
        var lower = contentType.ToLowerInvariant();
        return lower.Contains("text/") || 
               lower.Contains("application/json") || 
               lower.Contains("application/javascript") || 
               lower.Contains("application/xml") || 
               lower.Contains("application/vnd.api+json");
    }

    /**
     * 函数名称：JsonError
     * 功能描述：返回 JSON 格式的错误信息响应
     */
    private async Task JsonError(HttpContext context, string msg, int status)
    {
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";
        // 防止响应头有压缩，因为我们要直接写入明文
        context.Response.Headers.Remove("Content-Encoding"); 
        await context.Response.WriteAsync($"{{\"error\":\"{msg}\"}}");
    }

    /**
     * 类名称：CustomTransformer
     * 功能描述：YARP 请求内容变换器，可以在代理发送给目标前修改请求，以及返回给客户端前修改响应
     */
    private class CustomTransformer : HttpTransformer
    {
        private readonly ProxyConfig _config;
        private readonly string _actualUrlStr;

        public CustomTransformer(ProxyConfig config, string actualUrlStr)
        {
            _config = config;
            _actualUrlStr = actualUrlStr;
        }

        /**
         * 函数名称：TransformRequestAsync
         * 功能描述：转发请求前的变换，覆盖 Host，并过滤黑名单 Header
         */
        public override async ValueTask TransformRequestAsync(HttpContext httpContext, HttpRequestMessage proxyRequest, string destinationPrefix, CancellationToken cancellationToken)
        {
            await base.TransformRequestAsync(httpContext, proxyRequest, destinationPrefix, cancellationToken);
            
            // 确保发送到目标站点的 Host 头为目标真实的域名
            proxyRequest.Headers.Host = new Uri(_actualUrlStr).Authority;

            // 过滤特定前缀的请求头
            if (_config.FilteredHeaderPrefixes != null)
            {
                foreach (var prefix in _config.FilteredHeaderPrefixes)
                {
                    var toRemove = proxyRequest.Headers.Where(h => h.Key.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)).Select(h => h.Key).ToList();
                    foreach (var h in toRemove) proxyRequest.Headers.Remove(h);
                }
            }

            // 过滤指定的敏感请求头
            if (_config.FilteredSensitiveHeaders != null)
            {
                foreach (var h in _config.FilteredSensitiveHeaders)
                {
                    proxyRequest.Headers.Remove(h);
                }
            }
        }

        /**
         * 函数名称：TransformResponseAsync
         * 功能描述：收到目标响应后处理其内容，支持 HTML 路径重写、内容替换、处理重定向跳转以及禁用缓存
         */
        public override async ValueTask<bool> TransformResponseAsync(HttpContext httpContext, HttpResponseMessage? proxyResponse, CancellationToken cancellationToken)
        {
            await base.TransformResponseAsync(httpContext, proxyResponse, cancellationToken);
            if (proxyResponse == null) return true;

            // 1. 处理 HTTP 3xx 重定向状态码
            int status = (int)proxyResponse.StatusCode;
            if (status is 301 or 302 or 303 or 307 or 308 && proxyResponse.Headers.Location != null)
            {
                string location = proxyResponse.Headers.Location.ToString();
                try
                {
                    var baseUri = new Uri(_actualUrlStr);
                    var absUri = new Uri(baseUri, location); // 解析可能为相对路径的重定向地址
                    // 修改重定向 Location，将其导向我们代理服务器自身的解析格式
                    httpContext.Response.Headers["Location"] = "/" + Uri.EscapeDataString(absUri.ToString());
                }
                catch
                {
                    httpContext.Response.Headers["Location"] = "/" + Uri.EscapeDataString(location);
                }
                // 清除原生响应中的 Location，交由我们处理的 Location 在上面写入 httpContext
                proxyResponse.Headers.Location = null;
                return true; // 返回 true 以阻止剩余的默认重定向逻辑干扰
            }

            // 2. 处理响应体内容的修改（重写与替换）
            string? contentType = proxyResponse.Content?.Headers.ContentType?.MediaType;
            bool isHtml = contentType?.Contains("text/html", StringComparison.OrdinalIgnoreCase) == true;
            bool isText = isHtml || contentType?.Contains("text/", StringComparison.OrdinalIgnoreCase) == true || 
                          contentType?.Contains("application/json", StringComparison.OrdinalIgnoreCase) == true ||
                          contentType?.Contains("application/javascript", StringComparison.OrdinalIgnoreCase) == true ||
                          contentType?.Contains("application/xml", StringComparison.OrdinalIgnoreCase) == true;

            bool hasHtmlRewrite = _config.HtmlPathRewriteScope?.Count > 0;
            bool hasResReplace = _config.ReplaceRules?.Any(r => string.Equals(r.Direction, "response", StringComparison.OrdinalIgnoreCase) || string.Equals(r.Direction, "both", StringComparison.OrdinalIgnoreCase)) == true;

            // 需要修改响应体的条件匹配
            if (proxyResponse.Content != null && ((isHtml && hasHtmlRewrite) || (isText && hasResReplace)))
            {
                var bytes = await proxyResponse.Content.ReadAsByteArrayAsync(cancellationToken);
                var text = Encoding.UTF8.GetString(bytes);

                // HTML 重写静态资源路径
                if (isHtml && hasHtmlRewrite)
                {
                    var targetOrigin = new Uri(_actualUrlStr).GetLeftPart(UriPartial.Authority);
                    text = HtmlRewriter.RewriteHtml(text, httpContext.Request.Scheme, httpContext.Request.Host.Value ?? "", targetOrigin, _config.HtmlPathRewriteScope);
                }

                // 内容替换规则
                if (isText && hasResReplace)
                {
                    var modifiedText = ContentReplacer.ApplyReplaceRules(text, "response", _config.ReplaceRules);
                    if (contentType?.Contains("application/json", StringComparison.OrdinalIgnoreCase) == true)
                    {
                        try { System.Text.Json.JsonDocument.Parse(modifiedText); text = modifiedText; } 
                        catch { /* JSON被破坏，回退使用修改前的文本 */ }
                    }
                    else 
                    {
                        text = modifiedText;
                    }
                }

                // 包装修改后的响应体
                var newBytes = Encoding.UTF8.GetBytes(text);
                var originalHeaders = proxyResponse.Content.Headers;
                proxyResponse.Content = new ByteArrayContent(newBytes);
                
                // 恢复除长度和压缩编码外的其他所有响应头信息
                foreach (var header in originalHeaders)
                {
                    if (!header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) && 
                        !header.Key.Equals("Content-Encoding", StringComparison.OrdinalIgnoreCase))
                    {
                        proxyResponse.Content.Headers.TryAddWithoutValidation(header.Key, header.Value);
                    }
                }
                // 移出原有的编码头（由于解压重写，不再是 gzip/br 等格式）
                httpContext.Response.Headers.Remove("Content-Encoding");
            }

            // 3. 处理禁用缓存逻辑
            if (_config.DisableCache)
            {
                httpContext.Response.Headers.CacheControl = "no-store";
                if (proxyResponse.Headers.CacheControl == null) 
                    proxyResponse.Headers.CacheControl = new CacheControlHeaderValue();
                proxyResponse.Headers.CacheControl.NoStore = true;
            }

            // 4. 追加跨域 CORS 配置，允许所有来源访问代理服务资源
            httpContext.Response.Headers.AccessControlAllowOrigin = "*";
            httpContext.Response.Headers.AccessControlAllowMethods = "GET, POST, PUT, DELETE, HEAD, OPTIONS, PATCH";
            httpContext.Response.Headers.AccessControlAllowHeaders = "*";

            return true;
        }
    }
}
