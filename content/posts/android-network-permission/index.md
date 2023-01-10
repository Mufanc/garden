+++
title = '理解 Android 中的网络子系统'
summary = '深入挖掘「网络权限」与「联网控制」的设计思想和内部细节'
date = 2023-01-07T00:19:27+08:00
slug = 'dafde382'
tags = []
categories = []
draft = false
showtoc = true
+++

## 网络权限

我们知道，只有声明了 `android.permission.INTERNET` 权限的应用才可以访问互联网，那么这种限制究竟是如何实现的呢？

### 应用的联网过程

想要知道系统如何对应用进行网络权限的控制，首先就要搞清楚应用是如何访问互联网的，而 Android 系统的内核又基于 Linux，所以我们不妨先搞清楚 Linux 上的一个 C++ 程序是如何访问互联网的

* `socket` 系统调用

Linux 提供了一个 `socket` 系统调用，用于创建各种网络相关的通信端点，在终端输入 `man 5 proc` 或者查看 [在线手册](https://man7.org/linux/man-pages/man2/socket.2.html) 都能找到该系统调用的描述

参照文档中的说明，我们只要几十行代码就能写出一个丐中丐版的 `curl`：

```c++
#include <cstdio>
#include <cstring>
#include <arpa/inet.h>
#include <sys/socket.h>

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: %s <IP>\n", argv[0]);
        return 1;
    }

    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd == -1) {
        perror("socket");
        return 1;
    }

    sockaddr_in addr {
        .sin_family = AF_INET,
        .sin_port = htons(80),
        .sin_addr = { inet_addr(argv[1]) }
    };

    if (connect(fd, (sockaddr *) &addr, sizeof(addr)) == -1) {
        perror("connect");
        return 1;
    }

    char request[256];
    snprintf(
        request, sizeof(request),
        "GET %s HTTP/1.1\r\n"
        "Cache-Control: no-cache\r\n"
        "Connection: close\r\n\r\n",
        argv[1]
    );

    if (send(fd, request, strlen(request), 0) == -1) {
        perror("send");
        return 1;
    }

    char buffer[1024] = {0};
    size_t offset = 0, length;

    while ((length = recv(fd, buffer + offset, sizeof(buffer) - offset, 0))) {
        offset += length;
    }

    printf("%s", buffer);

    return 0;
}

```

由于我们的程序不支持 DNS 查询，所以需要这么用：

```bash
./simple-curl $(dig +short google.com)
```

尽管它十分简陋，但已经足够拿到正确的响应报文：

```http
HTTP/1.1 301 Moved Permanently
Location: http://www.google.com/
Content-Type: text/html; charset=UTF-8
Cross-Origin-Opener-Policy-Report-Only: same-origin-allow-popups; report-to="gws"
Report-To: {"group":"gws","max_age":2592000,"endpoints":[{"url":"https://csp.withgoogle.com/csp/report-to/gws/other"}]}
Date: Sat, 07 Jan 2023 07:12:20 GMT
Expires: Mon, 06 Feb 2023 07:12:20 GMT
Cache-Control: public, max-age=2592000
Server: gws
Content-Length: 219
X-XSS-Protection: 0
X-Frame-Options: SAMEORIGIN
Connection: close

<HTML><HEAD><meta http-equiv="content-type" content="text/html;charset=utf-8">
<TITLE>301 Moved</TITLE></HEAD><BODY>
<H1>301 Moved</H1>
The document has moved
<A HREF="http://www.google.com/">here</A>.
</BODY></HTML>

```

正是 `socket`、`connect`、`send`、`recv` 这些简单的系统调用，构筑了 Linux 网络大厦的基石。在 Android 系统上也并无什么不同，无论上层再怎么封装，最终都还是要回归到最基本的系统调用上来

### 网络权限管理

* `inet` 用户组

如果你经常使用 Termux，那么大概已经注意到 Android 有一个 `inet` 用户组，那么这个 `inet` 用户组是否对应着网络权限呢？

我们知道，Android 会通过给应用加入不同用户组来完成应用间的隔离操作和部分权限控制功能，而网络权限又属于 [一般权限](https://developer.android.google.cn/guide/topics/permissions/overview?hl=zh_cn#normal)，即应用安装后就会授予，用户无法撤销（可以禁止应用访问网络，但不能撤销应用的网络权限）

不妨来测试一下，新建一个 Empty Activity 应用，不声明任何权限，查看其进程的用户组列表：

```shell { hl_lines=[7] }
emu64x:/ $ cat /proc/$(pidof network.poc)/status                   
Name:   network.poc
...
Uid:    10161   10161   10161   10161
Gid:    10161   10161   10161   10161
FDSize: 128
Groups: 9997 20161 50161 
...
```

添加网络权限后，再次查看用户组列表：

```shell { hl_lines=[7] }
emu64x:/ $ cat /proc/$(pidof network.poc)/status
Name:   network.poc
...
Uid:    10161   10161   10161   10161
Gid:    10161   10161   10161   10161
FDSize: 128
Groups: 3003 9997 20161 50161 
...
```

可以看到多出来了一个 3003 用户组，即 `inet` 用户组！似乎网络权限和这个用户组确实存在着某种关联。继续在 Termux 中测试：

```shell
$ unset LD_PRELOAD  # 避免使用 os.system 时出问题
$ sudo python
> from os import *
> system('id')
uid=0(root) gid=0(root) groups=0(root)
> setgid(2000)
> setuid(2000)
> system('id')
uid=2000(shell) gid=2000(shell) groups=2000(shell) context=u:r:magisk:s0
> system('curl google.com')
curl: (6) Could not resolve host: google.com
```

这次多加入一个 `inet` 用户组：

```shell
$ unset LD_PRELOAD
$ sudo python
> from os import *
> system('id')
uid=0(root) gid=0(root) groups=0(root)
> setgid(2000)
> setgroups([3003])
> setuid(2000)
> system('id')
uid=2000(shell) gid=2000(shell) groups=2000(shell),3003(inet) context=u:r:magisk:s0
> system('curl google.com')
<HTML><HEAD><meta http-equiv="content-type" content="text/html;charset=utf-8">
<TITLE>301 Moved</TITLE></HEAD><BODY>
<H1>301 Moved</H1>
The document has moved
<A HREF="http://www.google.com/">here</A>.
</BODY></HTML>
```

然后就能够正常访问网络了，在源码中稍加搜索，可以在 [这个头文件](http://aospxref.com/android-12.0.0_r3/xref/system/core/libcutils/include/private/android_filesystem_config.h#152) 里找到相关注释，只有 groups 包含 3003 的进程才能创建 `AF_INET` 和 `AF_INET6` 类型的 socket：

```c++
#define AID_INET 3003    /* can create AF_INET and AF_INET6 sockets */
```

而在 `/system/etc/permissions/platform.xml` 中也有相应的映射：

```xml
<permissions>
    <!--  The following tags are associating low-level group IDs with
        permission names.  By specifying such a mapping, you are saying
        that any application process granted the given permission will
        also be running with the given group ID attached to its process,
        so it can perform any filesystem (read, write, execute) operations
        allowed for that group.  -->
    ...
    <permission name="android.permission.INTERNET">
        <group gid="inet"/>
    </permission>
    ...
</permissions>
```

这样一来，便坐实了我们的猜想，「网络权限」这种东西，确实是由 `inet` 用户组来控制的。但是网卡和 字符设备/块设备 不同，在 `/dev` 底下并没有与之对应的设备文件，那么系统又是如何通过用户组来限制应用的 `socket` 调用的呢？

根据 [上面](#应用的联网过程) 的分析，网络是一个相当底层的东西，极端情况下，用户甚至有可能通过内联汇编或者静态链接库来发起 `socket` 系统调用，所以其并不像其它上层权限那样，能够轻易地从 framework 进行拦截，而是需要内核参与支持

### 疑惑 - 柳暗

在源码树中 [搜索](https://cs.android.com/search?q=AID_INET) `AID_INET` 的引用，并没有看到什么有用的东西，所以内核究竟是如何限制 `socket` 调用的🤔

Process 类倒是有个 [`INET_GID`](http://aospxref.com/android-12.0.0_r3/xref/frameworks/base/core/java/android/os/Process.java#260)，也注明了其值会保持与 `AID_INET` 的值相同，那么不妨试试从这里展开分析

```java
/**
 * GID that corresponds to the INTERNET permission.
 * Must match the value of AID_INET.
 * @hide
 */
public static final int INET_GID = 3003;
```

在 `Zygote.java` 中有个 [`containsInetGid`](http://aospxref.com/android-12.0.0_r3/xref/frameworks/base/core/java/com/android/internal/os/Zygote.java#292) 函数访问了这个常量，函数接受一个整型数组，并遍历数组查找其中是否存在网络用户组：

```java
private static boolean containsInetGid(int[] gids) {
    for (int i = 0; i < gids.length; i++) {
        if (gids[i] == android.os.Process.INET_GID) return true;
    }
    return false;
}
```

继续搜索其引用，这里出现了一个我们十分熟悉的函数：[`specializeAppProcess`](http://aospxref.com/android-12.0.0_r3/xref/frameworks/base/core/java/com/android/internal/os/Zygote.java#404)

```java { hl_lines=[13] }
private static void specializeAppProcess(int uid, int gid, int[] gids, int runtimeFlags,
        int[][] rlimits, int mountExternal, String seInfo, String niceName,
        boolean startChildZygote, String instructionSet, String appDataDir, boolean isTopApp,
        String[] pkgDataInfoList, String[] allowlistedDataInfoList,
        boolean bindMountAppDataDirs, boolean bindMountAppStorageDirs) {
    nativeSpecializeAppProcess(uid, gid, gids, runtimeFlags, rlimits, mountExternal, seInfo,
            niceName, startChildZygote, instructionSet, appDataDir, isTopApp,
            pkgDataInfoList, allowlistedDataInfoList,
            bindMountAppDataDirs, bindMountAppStorageDirs);
    // Note that this event ends at the end of handleChildProc.
    Trace.traceBegin(Trace.TRACE_TAG_ACTIVITY_MANAGER, "PostFork");
    if (gids != null && gids.length > 0) {
        NetworkUtilsInternal.setAllowNetworkingForProcess(containsInetGid(gids));
    }
    // Set the Java Language thread priority to the default value for new apps.
    Thread.currentThread().setPriority(Thread.NORM_PRIORITY);
    /*
     * This is called here (instead of after the fork but before the specialize) to maintain
     * consistancy with the code paths for forkAndSpecialize.
     *
     * TODO (chriswailes): Look into moving this to immediately after the fork.
     */
    ZygoteHooks.postForkCommon();
}
```

它根据参数中的 gids，判断是否需要调用 [`NetworkUtilsInternal`](http://aospxref.com/android-12.0.0_r3/xref/frameworks/base/core/java/com/android/internal/net/NetworkUtilsInternal.java#38) 类的一个 native 方法（来设置应用的网络访问权限？），源码中的描述如下：

```java
/**
 * Allow/Disallow creating AF_INET/AF_INET6 sockets and DNS lookups for current process.
 *
 * @param allowNetworking whether to allow or disallow creating AF_INET/AF_INET6 sockets
 *                        and DNS lookups.
 */
public static native void setAllowNetworkingForProcess(boolean allowNetworking);
```

一路追踪，最后这个布尔值被存到了 [NetdClient](http://aospxref.com/android-12.0.0_r3/xref/system/netd/client/NetdClient.cpp#609) 的一个原子变量里面：

```c++ 
std::atomic_bool allowNetworkingForProcess(true);

...

extern "C" void setAllowNetworkingForProcess(bool allowNetworking) {
    allowNetworkingForProcess.store(allowNetworking);
}
```

在 [`netdClientSocket`](http://aospxref.com/android-12.0.0_r3/xref/system/netd/client/NetdClient.cpp#187) 中访问了这个变量，判断 socket 类型是否为 `AF_INET` 或 `AF_INET6`，且被设置为不允许访问网络：

```c++ { hl_lines=[3] }
int netdClientSocket(int domain, int type, int protocol) {
    // Block creating AF_INET/AF_INET6 socket if networking is not allowed.
    if (FwmarkCommand::isSupportedFamily(domain) && !allowNetworkingForProcess.load()) {
        errno = EPERM;
        return -1;
    }
    int socketFd = libcSocket(domain, type, protocol);
    if (socketFd == -1) {
        return -1;
    }
    unsigned netId = netIdForProcess & ~NETID_USE_LOCAL_NAMESERVERS;
    if (netId != NETID_UNSET && FwmarkClient::shouldSetFwmark(domain)) {
        if (int error = setNetworkForSocket(netId, socketFd)) {
            return closeFdAndSetErrno(socketFd, error);
        }
    }
    return socketFd;
}
```

看似非常合理，但这一切都是 fork 之后发生的事情啊！这里并没有涉及到远程调用，所以一切操作都将发生在应用进程自己的地址空间，「坏蛋应用」完全可以通过某种手段来修改这里的限制

然而事实却是：即使 Hook `containsInetGid` 使其永远返回 `true`，设定上无法联网的应用依旧无法联网（显然 Android 也不会真的只用这么愚蠢的手段来限制应用联网），然而翻遍内核代码却又找不到在哪里有对 groups 作判断……

几番搜索，有用的资料却寥寥无几，根本都是些过时的内容…… 只知道早期版本的 Android [引入](https://android.googlesource.com/kernel/common/+/ec2622b0c41f49e3e8bef9b7ac10c59ebc6432c2%5E%21/) 了一个特殊的内核补丁：[Paranoid Networking](https://elinux.org/Android_Security#Paranoid_network-ing)，来限制低级系统功能的访问。例如对于负责网络通信的 `AF_INET` 地址族，会在 [`af_inet.c`](https://android.googlesource.com/kernel/common/+/ec2622b0c41f49e3e8bef9b7ac10c59ebc6432c2/net/ipv4/af_inet.c#244) 中完成权限检查：


```c { hl_lines=[2,8,30] }
#ifdef CONFIG_ANDROID_PARANOID_NETWORK
#include <linux/android_aid.h>
#endif

...

#ifdef CONFIG_ANDROID_PARANOID_NETWORK
static inline int current_has_network(void) {
	return (!current_euid() || in_egroup_p(AID_INET) ||
		in_egroup_p(AID_NET_RAW));
}
static inline int current_has_cap(struct net *net, int cap) {
	if (cap == CAP_NET_RAW && in_egroup_p(AID_NET_RAW))
		return 1;
	return ns_capable(net->user_ns, cap);
}
# else
static inline int current_has_network(void) {
	return 1;
}
static inline int current_has_cap(struct net *net, int cap) {
	return ns_capable(net->user_ns, cap);
}
#endif

...

static int inet_create(struct net *net, struct socket *sock, int protocol, int kern) {
	...
	if (!current_has_network())
		return -EACCES;
    ...
}
```

然而到了本文所研究的 Android 12 上，却完全不见其踪迹，让人不得不怀疑 Android 使用了某种更加高明的手段来完成权限检查，但要完整的追踪整个 `socket` 系统调用流，找出鉴权的地方，又实在是成本过高……

### 疑惑 - 花明

等等！

我们还好像漏掉了一个至关重要的工具 —— git！有插入就必然有删除，既然这些内核源码托管在 git 上，那么我们便可以通过搜索文件的变更记录来得知，是哪一个提交删除了这个功能，从而通过 commit message 获得更加详细的信息

首先将整个仓库 clone 到本地：

```bash
git clone https://android.googlesource.com/kernel/common
```

搜索 `as_inet.c` 的变更记录：

```bash
git log -S current_has_network --all -- net/ipv4/af_inet.c
```

果然出现了我们想要找的东西：

```text
commit 317336de579f9ffd608709728732b064e78df403
Author: Chenbo Feng <fengc@google.com>
Date:   Thu Mar 28 17:52:21 2019 -0700

    ANDROID: Remove Android paranoid check for socket creation
    
    For 4.14+ kernels, eBPF cgroup socket filter is used to control socket
    creation on devices. Remove this check since it is no longer useful.
    
    Signed-off-by: Chenbo Feng <fengc@google.com>
    Bug: 128944261
    Test: CtsNetTestCasesInternetPermission
    Change-Id: I2f353663389fc0f992e5a1b424c12215a2b074b0
```

提交信息说得很清楚，在 4.14+ 版本的内核上，将由「eBPF cgroup socket filter」来管理 socket 的创建

**-- 未完待续 --**

## 联网控制

## 总结
