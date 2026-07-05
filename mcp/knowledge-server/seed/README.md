# 种子数据目录

此目录存放公共知识库的原始数据文件（JSON 格式）。

## 文件结构

```
seed/
├── README.md
├── laws.json        # 法条数据
├── cases.json       # 判例数据
├── terms.json       # 法律术语
└── templates/       # 模板文件（Markdown）
    └── *.md
```

## 数据格式

每个 JSON 文件是一个数组，每条目格式：

```json
{
  "id": "law-001",
  "type": "law",
  "title": "民法典第680条",
  "content": "禁止高利放贷，借款的利率不得违反国家有关规定。",
  "tags": ["民间借贷", "利率"],
  "reference": "民法典第680条"
}
```

## type 可选值

| type | 说明 |
|------|------|
| `law` | 法条 |
| `case` | 判例 |
| `term` | 法律术语 |
| `template` | 模板（放到 templates/ 子目录） |

## 编译

编辑 JSON 文件后，运行以下命令重新生成 `data/seed.db`：

```bash
cd mcp/knowledge-server
node scripts/build-seed.mjs
```

编译后需提交 `data/seed.db` 到 git。

## 注意事项

- `id` 需唯一
- `type` 必须为上述可选值之一
- `tags` 用于知识图谱关联，相同 tag 的条目会在图谱中建立边
- 法条内容建议准确引用原文
- 判例需包含案号
