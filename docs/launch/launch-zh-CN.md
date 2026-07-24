# 中文发布文案

## 短版

我把一个很具体的问题做成了开源插件：外部模型能在 Codex 里运行，也能调用 MCP，但它不会自动继承 Codex 的实时联网搜索。

Codex Search Bridge 只提供一个研究工具。后台启动隔离的 `codex --search exec`，再检查 JSONL 里是不是真的发生了搜索和网页打开，引用 URL 能不能对上，发布时间和事件日期有没有混在一起。查不到的内容就标成未确认，不让模型硬凑一个答案。

它有明确限制：模型本身必须会调用 MCP；本机要登录 Codex；搜索会消耗用户自己的配额。这是社区项目，不是 OpenAI 官方插件。

源码与安装：
https://github.com/Zhao73/codex-search-bridge

## 长版

我一直想解决一个边界问题。

在 Codex Desktop 或 CLI 里换成开源模型之后，模型可以写代码，也可能会调用 MCP，但问它“今天发生了什么”时，联网、打开网页、核对日期和引用来源往往不是一套可靠流程。

Codex Search Bridge 把这件事收窄成一个 `research_web` 工具。外部模型负责提问，Bridge 在后台启动一次独立的 Codex 实时搜索，然后核对运行证据：

- JSONL 里是否出现了真实的 `web_search`；
- 标准研究是否执行了 `open_page`；
- 最终来源 URL 是否在事件里出现；
- `published_at`、`updated_at`、`event_date`、`retrieved_at` 是否分开；
- 哪些主张仍是未确认，哪些来源互相冲突。

证据不够，工具就失败。模型在回答里写一句“我搜索过”不算数。

这个项目不会让不支持工具调用的模型突然学会 MCP。它也不会绕过 Codex 登录、工作区策略或配额。边界写清楚，比一句“支持所有模型”更有用。

Apache-2.0 开源，社区维护，不是 OpenAI 官方插件。

仓库：
https://github.com/Zhao73/codex-search-bridge

## 标题备选

1. 让开源模型借用 Codex 的实时搜索
2. 给 Codex 里的外部模型一条可验证的联网通道
3. 搜索过没有，先看证据
