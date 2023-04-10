+++
title = 'Shell 中的变量操作'
summary = '奇怪的笔记增加了'
date = 2023-04-09T23:22:04+08:00
slug = '5b865719'
tags = []
categories = []
draft = false
+++

## 特殊变量

* `$0`

Shell 解释器的路径（终端中），或 Shell 脚本的路径（执行脚本时），可以理解为当前进程的   `argv[0]`：

```shell
> echo $0
/usr/bin/zsh
```

* `$1, $2, $3, ...`

同上，进程的 `argv[1]`、`argv[2]`、`argv[3]` ……

```shell
> sh <(echo 'echo args: $1 $3') arg1 arg2 arg3 arg4
args: arg1 arg3
```

* `$#`

参数的个数，不包括 `$0`：

```shell
> sh <(echo 'echo count: $#') arg1 arg2 arg3 arg4
count: 4
```

* `$?`

上一次命令的的退出代码：

```shell
> sh -c 'exit 233'
> echo $?
233
```

* `$-`

显示 Shell 当前使用的选项，用得非常少：

```shell
> echo $-
0569BJPXZgims
```

*  `$$`

当前进程的 PID：

```shell
> cat /proc/$$/status | grep -E '^Pid:'
Pid:    1987

> cat /proc/$$/cmdline
/usr/bin/zsh
```

* `$!`

上一条后台命令的 PID：

```shell
> cat /proc/self/status | grep -E '^Pid' &
[1] 36902 36903  # 36903 是 grep 的 PID
Pid:    36902
[1]  + done       cat /proc/self/status | grep -i --color -E '^Pid'
```

* `$_`

上一条命令的最后一个参数：

```shell
> echo arg1 arg2 arg3 arg4
arg1 arg2 arg3 arg4

> echo $_
arg4
```

## 字符串截取

```shell
> VAR="123456"
```

* `${VAR:<BEGIN>}`

截取从下标 BEGIN 开始，直到结尾的子串：

```shell
> echo ${VAR:2}  
3456
```

* `${VAR:<BEGIN>:<LEN>}`

截取从下标 BEGIN 开始，长为 LEN 的子串：

```shell
> echo ${VAR:1:3}  
234
```

* `${VAR:0-<BEGIN>}`

截取从右边第 BEGIN 个字符开始，直到结尾的子串：

```shell
> echo ${VAR:0-2}
56
```

* `${VAR:0-<BEGIN>:<LEN>}`

截取从右边第 BEGIN 个字符开始，长度为 LEN 的子串：

```shell
> echo ${VAR:0-4:2}
34
```

## 查找替换

```shell
> VAR="114514"
```

* `${VAR#<STR>}`

从前往后，将匹配到的最短子串删除（`*` 表示通配符）：

```shell
> # 114514 
> # ^^
> echo ${VAR#1*1}
4514
```

* `${VAR##<STR>}`

从前往后，将匹配到的最长子串删除：

```shell
> # 114514
> # ^^^^^
> echo ${VAR##1*1}
4
```

* `${VAR%<STR>}`

从后往前，将匹配到的最短子串删除：

```shell
> # 114514
> #     ^^
> echo ${VAR%1*4}
1145
```

* `${VAR%%<STR>}`

从后往前，将匹配到的最长子串删除：

```shell
> # 114514
> # ^^^^^^
> echo ${VAR%%1*4}
(empty)
```

* `${VAR/<OLD>/<NEW>}`

将第一个匹配的 OLD 替换为 NEW：

```shell
> echo ${VAR/1/0}
014514
```

* `${VAR//<NEW>/<NEW>}`

将所有 OLD 替换为 NEW：

```shell
> echo ${VAR//1/0}
004504
```
