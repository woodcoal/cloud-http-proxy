using CloudHttpProxy;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

// 彻底禁用内置日志系统，避免系统信息干扰
builder.Logging.ClearProviders();

// 读取绑定配置
var proxyConfigSection = builder.Configuration.GetSection("ProxyConfig");
var bindIp = proxyConfigSection.GetValue<string>("BindIp") ?? "0.0.0.0";
var bindPort = proxyConfigSection.GetValue<int>("BindPort", 5000);

// 设置 Web 服务器绑定的 IP 和端口
builder.WebHost.UseUrls($"http://{bindIp}:{bindPort}");

// 绑定 appsettings.json 中的 ProxyConfig 节点到强类型配置
builder.Services.Configure<ProxyConfig>(proxyConfigSection);

// 注册 YARP HttpForwarder 服务（提供底层代理转发支持）
builder.Services.AddHttpForwarder();

var app = builder.Build();

// 注册并应用核心代理中间件，接管所有 HTTP 请求的处理流程
app.UseMiddleware<ProxyMiddleware>();

// 获取配置判断是否需要输出日志
var config = app.Services.GetRequiredService<IOptions<ProxyConfig>>().Value;

// 显式监听退出事件，提供即时反馈
var lifetime = app.Services.GetRequiredService<IHostApplicationLifetime>();
lifetime.ApplicationStopping.Register(() => {
	if (!string.Equals(config.LogLevel, "none", StringComparison.OrdinalIgnoreCase)) {
		Console.WriteLine("\n\u001b[33m[系统] 正在关闭代理服务...\u001b[0m");
	}
});

if (!string.Equals(config.LogLevel, "none", StringComparison.OrdinalIgnoreCase)) {
	Console.WriteLine($"\u001b[36m代理服务已启动: http://{bindIp}:{bindPort} ({DateTime.Now:MM/dd HH:mm:ss})");
	Console.WriteLine("\x1b[90m提示: 按 Ctrl+C 可停止服务\x1b[0m");
}

// 启动 Web 服务
await app.RunAsync();
