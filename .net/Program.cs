using CloudHttpProxy;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);

// 绑定 appsettings.json 中的 ProxyConfig 节点到强类型配置
builder.Services.Configure<ProxyConfig>(builder.Configuration.GetSection("ProxyConfig"));

// 注册 YARP HttpForwarder 服务（提供底层代理转发支持）
builder.Services.AddHttpForwarder();

var app = builder.Build();

// 注册并应用核心代理中间件，接管所有 HTTP 请求的处理流程
app.UseMiddleware<ProxyMiddleware>();

// 启动 Web 服务
app.Run();
