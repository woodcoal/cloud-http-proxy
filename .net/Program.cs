using CloudHttpProxy;

var builder = WebApplication.CreateBuilder(args);

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

// 启动 Web 服务
app.Run();
