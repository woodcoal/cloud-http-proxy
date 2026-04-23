using System.Net;
using System.Text.RegularExpressions;
using System.Collections.Generic;

namespace CloudHttpProxy;

/**
 * 类名称：IpUtils
 * 功能描述：提供 IP 地址验证和匹配相关的实用工具方法，支持精确匹配、通配符匹配和 CIDR 掩码匹配
 */
public static class IpUtils
{
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
    public static bool IsIpAllowed(string clientIp, List<string>? whitelist)
    {
        // 如果白名单未配置或为空，则默认允许所有 IP 访问
        if (whitelist == null || whitelist.Count == 0) return true;
        
        // 无法获取到有效 IP，拒绝访问
        if (string.IsNullOrEmpty(clientIp) || clientIp == "unknown") return false;

        foreach (var pattern in whitelist)
        {
            if (MatchIpPattern(clientIp, pattern)) return true;
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
    private static bool MatchIpPattern(string clientIp, string pattern)
    {
        // 1. 精确匹配
        if (clientIp == pattern) return true;

        // 2. 通配符匹配 (例如 192.168.1.*)
        if (pattern.Contains('*'))
        {
            string regexPattern = "^" + Regex.Escape(pattern).Replace("\\*", ".*") + "$";
            return Regex.IsMatch(clientIp, regexPattern);
        }

        // 3. CIDR 掩码匹配 (例如 192.168.1.0/24)
        if (pattern.Contains('/'))
        {
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
    private static bool CidrMatch(string ipStr, string cidr)
    {
        try
        {
            var parts = cidr.Split('/');
            if (parts.Length != 2) return false;

            if (!IPAddress.TryParse(parts[0], out var network) || !IPAddress.TryParse(ipStr, out var ip))
                return false;

            if (!int.TryParse(parts[1], out int maskLen))
                return false;

            // IPv4 和 IPv6 必须对应才能比较
            if (network.AddressFamily != ip.AddressFamily) return false;

            byte[] ipBytes = ip.GetAddressBytes();
            byte[] netBytes = network.GetAddressBytes();

            // 逐字节比对掩码长度范围内的位
            for (int i = 0; i < ipBytes.Length; i++)
            {
                if (maskLen >= 8)
                {
                    if (ipBytes[i] != netBytes[i]) return false;
                    maskLen -= 8;
                }
                else if (maskLen > 0)
                {
                    int mask = 0xFF << (8 - maskLen);
                    if ((ipBytes[i] & mask) != (netBytes[i] & mask)) return false;
                    maskLen = 0;
                }
            }
            return true;
        }
        catch
        {
            // 解析异常时保守返回 false
            return false;
        }
    }
}
