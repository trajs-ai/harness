# Harness 设计

整个框架只围绕一个概念展开：Plugin。下面各节说明这个概念要成立所需定义的内容。

**读者**：`@trajs/harness` 的实现者。

## Trajectory 与 prompt

一次运行被记录为一条 **trajectory**，即一个只追加的 **event** 序列。event 一经写入不再修改，也不再删除，所以运行过程通过折叠（fold）它的 event 来读取。

**prompt** 是发送给 LLM provider 的消息数组，且始终是派生结果。在某一点上，`fold(trajectory)` 就是该点要发送的 prompt。没有组件维护 prompt，也没有组件原地修改它：prompt 是 trajectory 的一个视图，而不是第二个事实来源。

由此得到唯一的运行循环：

```
prompt   = fold(trajectory)
response = provider(prompt)       → 一个持有 response part 的 event
events   = 依次执行的 plugin      → 追加到 trajectory 的 event
```

在任意更早的位置折叠，都能精确重建 provider 当时收到的 prompt。

## Event

一个 event 包含 **part** 与 **edit**。

| 字段    | 含义                                      |
| ------- | ----------------------------------------- |
| `uuid`  | event 的标识                              |
| `parts` | 本 event 新增的 part，位于本 event 的位置 |
| `edits` | 本 event 对已有 part 的改写               |

**part** 是运行中的一个条目：一条消息、一次 session 声明、一份领域数据。每个 part 有 uuid，且只有持有它的 event 能引入它。

**edit** 以 uuid 指名一个 part，声明 prompt 从本 event 起如何持有它。edit 的种类是开放的：替换为另一个 part、移除它，都只是其中一种，新增一类 edit 只多一种改写，不动折叠规则。

```
fold(trajectory) =
  slots = []                              // 位置，按 event 顺序排列的 uuid
  form = {}                               // 形态，uuid 到它此刻的形态
  for event in trajectory:
    for part in event.parts:
      slots.push(part.uuid)
      form[part.uuid] = part
    for edit in event.edits:
      form[edit.target] = apply(form[edit.target], edit)
  slots.map(uuid => form[uuid]).filter(holds)
```

`apply` 由 edit 的种类定义，`holds` 判断一种形态是否进入 prompt。整个设计由一条规则支撑：part 在它所属 event 的位置进入 prompt，之后的 edit 只改变该位置上的形态，从不改变位置。因此折叠是对 trajectory 的一次遍历，trajectory 是折叠唯一读取的状态。

## Plugin

plugin 表现为一个映射：给定 trajectory，得到它要追加的 event。

```
plugin: Trajectory<E> → Event*
```

只追加不是对 plugin 能力的限制，而是它表达决定的方式。要增添内容，plugin 追加 part；要改变 trajectory 中已有的 part，plugin 追加一个 edit。edit 按 uuid 指向任意 part，包括 schema 对它不可读的 part。当前 prompt 就是入参 trajectory 的折叠结果，所以 plugin 不需要第二个参数就能读到它据以决策的状态。

由此有两点，也正是设计的目的：

- plugin 可以整体重写 prompt：移除全部消息，替换其中任意一条，再添加自己的消息。
- plugin 的任何动作都不是原地的。它之前的前缀仍然读作原来的样子，在该前缀上折叠也不受影响。

## Trajectory 扩展

part 分为两类：

- **通用**：运行自身的内容，即 session，以及 prompt 与 response 中的消息。
- **领域**：plugin 自己生产并读取的内容，例如摘要、token 计数、检索到的文档、provider 的簿记信息。

plugin 声明一个 **trajectory 扩展**，即它可读写的领域 part 的 schema。`E` 就是这个声明，plugin 收到的 trajectory 暴露通用 part 与它自己的领域 part。plugin 跨轮读取自己产生的领域数据，不必知道别的 plugin 的数据；多个 plugin 也因此不必依赖彼此的 schema。

## 组合

plugin 之间有序。每个 plugin 收到的 trajectory 就是此前各个 plugin 留下的状态：它们的 event 已在其中，它们的 edit 已在折叠中生效。于是第二个 plugin 面对的是第一个 plugin 产出的 prompt，如同后一个 middleware（中间件）看到前一个 middleware 返回的状态。

顺序就是组合的全部内容。两个互不读取对方领域数据的 plugin，仍然对它们共同构造的 prompt 没有分歧，因为 prompt 是对全部 event 的一次折叠，顺序即 plugin 追加的顺序。

## 由此自然得到的行为

其他 agent 框架硬编码的行为，在这里都是一个 event。

| 行为                      | 对应的 event                                         |
| ------------------------- | ---------------------------------------------------- |
| compaction（上下文压缩）  | 一条 system message，加一个移除它之前所有消息的 edit |
| tool call 的结果          | tool result 消息；调用本身属于 response              |
| 过期 tool result 的占位符 | 无 part，只有一个替换它的 edit                       |
| plugin 自己的上下文       | 它的领域 part，以及它们过期后的 edit                 |

## 这种形状的好处

- **整体控制 prompt，逐 part 溯源。** plugin 可以重写 prompt 持有的任何内容，trajectory 仍然指出每个 part 由哪个 event 产生。
- **回退就是一个前缀。** 运行可以从记录过的任意 event 续起，重放其后的 event 即可得到 provider 当时收到的 prompt。
- **框架行为就是一个 plugin。** compaction、tool result 与 provider 适配都是 event，没有行为在 harness 中走特权路径。
- **发送内容只有一个答案。** prompt 是派生的，所以两个 plugin 不会对它产生分歧：该点的折叠就是 provider 收到的内容。
