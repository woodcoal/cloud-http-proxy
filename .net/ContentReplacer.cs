using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace CloudHttpProxy;

/**
 * 类名称：ContentReplacer
 * 功能描述：文本与 JSON 内容的规则替换引擎，支持基于正则、普通文本和 JSON 键值对递归遍历的文本替换功能
 */
public static class ContentReplacer
{
    /**
     * 函数名称：ApplyReplaceRules
     * 功能描述：应用规则列表对给定的文本内容进行替换处理
     * 
     * @param text - 待替换的原始文本或 JSON 字符串
     * @param direction - 替换方向上下文（"request" 表示请求，"response" 表示响应）
     * @param rules - 用户配置的替换规则列表
     * @returns 替换操作后的字符串结果
     */
    public static string ApplyReplaceRules(string text, string direction, List<ReplaceRule>? rules)
    {
        if (rules == null || rules.Count == 0 || string.IsNullOrEmpty(text)) return text;

        // 筛选出适用当前方向的规则
        var applicableRules = rules.Where(r => 
            string.Equals(r.Direction, direction, StringComparison.OrdinalIgnoreCase) || 
            string.Equals(r.Direction, "both", StringComparison.OrdinalIgnoreCase)
        ).ToList();
        
        foreach (var rule in applicableRules)
        {
            if (string.IsNullOrEmpty(rule.Pattern) || rule.Replacement == null) continue;

            // 处理特殊模式：JSON 键值对遍历替换
            if (string.Equals(rule.JsonMode, "keyValue", StringComparison.OrdinalIgnoreCase) && IsJsonString(text))
            {
                try
                {
                    text = ApplyJsonReplace(text, rule);
                    continue;
                }
                catch
                {
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
    private static string ApplySingleReplace(string str, ReplaceRule rule)
    {
        if (string.IsNullOrEmpty(str)) return str;

        switch (rule.Type?.ToLowerInvariant())
        {
            case "regex":
                try
                {
                    var options = RegexOptions.None;
                    if (rule.Flags?.Contains('i', StringComparison.OrdinalIgnoreCase) == true) 
                        options |= RegexOptions.IgnoreCase;
                    return Regex.Replace(str, rule.Pattern, rule.Replacement, options);
                }
                catch { return str; } // 正则异常时安全返回原字符串
            
            case "exact":
                return str.Replace(rule.Pattern, rule.Replacement);
            
            case "replace":
            default:
                if (rule.Flags?.Contains('i', StringComparison.OrdinalIgnoreCase) == true)
                {
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
    private static bool IsJsonString(string str)
    {
        if (string.IsNullOrWhiteSpace(str)) return false;
        str = str.Trim();
        
        if ((str.StartsWith("{") && str.EndsWith("}")) || (str.StartsWith("[") && str.EndsWith("]")))
        {
            try 
            { 
                using var doc = JsonDocument.Parse(str); 
                return true; 
            } 
            catch { return false; }
        }
        return false;
    }

    /**
     * 函数名称：ApplyJsonReplace
     * 功能描述：解析 JSON 字符串为语法树结构并递归应用替换规则
     */
    private static string ApplyJsonReplace(string jsonText, ReplaceRule rule)
    {
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
    private static JsonNode? Traverse(JsonNode? node, ReplaceRule rule)
    {
        if (node is JsonArray arr)
        {
            var newArr = new JsonArray();
            foreach (var item in arr)
            {
                newArr.Add(Traverse(item?.DeepClone(), rule));
            }
            return newArr;
        }
        else if (node is JsonObject obj)
        {
            var newObj = new JsonObject();
            foreach (var kvp in obj)
            {
                // 对 JSON 键进行替换
                string newKey = ApplySingleReplace(kvp.Key, rule);
                // 对嵌套值递归处理
                newObj[newKey] = Traverse(kvp.Value?.DeepClone(), rule);
            }
            return newObj;
        }
        else if (node is JsonValue val && val.TryGetValue<string>(out string? strVal) && strVal != null)
        {
            // 仅对文本型 JSON 节点值进行替换
            return JsonValue.Create(ApplySingleReplace(strVal, rule));
        }
        return node;
    }
}
