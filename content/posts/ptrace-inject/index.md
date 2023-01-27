+++
title = '初探 ptrace 之代码注入'
summary = '在 ARM64 Android 环境下使用 ptrace 注入动态链接库的方法探究'
date = 2023-01-24T11:07:04Z
slug = '9506b464'
tags = []
categories = []
draft = false
showtoc = true
+++

尽管已经可以使用环境变量 `LD_PRELOAD` 非常方便地向进程注入我们自己的动态库，但偶尔还是会有向已经启动的进程注入代码的需求，这个时候就可以用到 `ptrace` 工具了

## `ptrace` 系统调用

要成为一个成熟的操作系统，实现「调试器」是一个必不可少的环节，它允许通过程序来控制另一个程序的执行过程，从而找出程序出现问题的地方，或是收集程序的系统调用情况…… 在 Linux 系统中，可以通过 `ptrace` 系统调用来实现这一功能

## 实现原理

`ptrace` 并不能直接进行「注入代码」这种操作，它所提供的都是非常底层的 API，例如读取目标进程的寄存器、从指定地址获取一小段内存等等……
    
要实现代码注入，还得稍微下点功夫，想办法用这些基本操作组合出所需的功能，下面是具体的实现细节：

### 附加到目标进程

通过 `PTRACE_ATTACH` 操作，来附加到一个由 pid 指定的进程，函数返回时子进程不会立即终停止执行，需要通过 `waitpid()` 来等待子进程真正停下来

```c++
void ptrace_attach(pid_t pid) {
    if (ptrace(PTRACE_ATTACH, pid, nullptr, nullptr) == -1) {
        ERROR("attach");
    }
    if (waitpid(pid, nullptr, WUNTRACED) != pid) {
        ERROR("waitpid");
    }
    INFO("attached to pid: %d", pid);
}
```

### 备份寄存器环境

为了 detach 之后能够恢目标进程的正常运行，需要先将寄存器备份一份出来，后续获取函数返回值的时候，也需要读取寄存器

```c++
void ptrace_get_regs(pid_t pid, pt_regs *regs) {
    iovec iov {
        .iov_base = regs,
        .iov_len = sizeof(*regs)
    };
    if (ptrace(PTRACE_GETREGS, pid, NT_PRSTATUS, &iov) == -1) {
        ERROR("backup regs");
    }
}
```

### 在目标进程中定位函数地址

系统中大部分可执行文件都是动态链接的，我们可以利用其中的函数来更方便地完成一些操作，通过解析 maps 文件分别得到本地和目标进程的动态库基址，加上本地计算得到的偏移量，就是目标进程的函数地址

```c++
uintptr_t get_module_base(pid_t pid, std::string libpath) {
    static std::map<std::pair<pid_t, std::string>, uintptr_t> cache;

    std::pair<pid_t, std::string> key(pid, libpath);
    if (cache.contains(key)) {
        return cache[key];
    }

    char maps_path[PATH_MAX];
    sprintf(maps_path, "/proc/%d/maps", pid);

    FILE *maps = fopen(maps_path, "r");
    if (maps == nullptr) {
        ERROR("open maps");
        return 0;
    }

    void *addr = nullptr;
    char path[PATH_MAX], perms[8], offset[16];

    while (fscanf(maps, "%p-%*p %s %s %*s %*s %[^\n]", &addr, perms, offset, path) != EOF) {
        if (perms[2] != 'x') continue;
        if (strcmp(path, libpath.c_str()) != 0) continue;
        INFO("%s: %p, offset: %s", libpath.c_str(), addr, offset);
        break;
    }

    fclose(maps);

    return cache[key] = (uintptr_t) addr - strtoull(offset, nullptr, 16);
}

uintptr_t get_func_addr(pid_t pid, std::string libpath, uintptr_t local_func) {
    uintptr_t local_base = get_module_base(getpid(), libpath);
    uintptr_t remote_base = get_module_base(pid, libpath);
    uintptr_t offset = local_func - local_base;
    INFO("function offset: %lx", offset);
    return remote_base + offset;
}
```

### 远程调用目标进程的函数

通过控制目标进程的寄存器，将 PC 指针指向目标函数地址，并在 R0～R5 传递参数，就可以实现远程函数调用了。同时将 LR 寄存器的值设置为 0，这样远程函数返回时就会触发 `SIGSEGV`，将控制权交还给调试器，此时再次获取目标进程的寄存器，就能拿到函数的返回值

```c++
template<class... T>
void call_remote(pid_t pid, pt_regs *regs, uintptr_t addr, T... args) {
    size_t index = 0;

    INFO("calling function at %lx", addr);
    for (int64_t it : { args... }) {
        INFO("args[%zu] = %ld", index, it);
        regs->regs[index++] = it;
    }

    regs->ARM_pc = addr;

    // 区分 ARM 和 THUMB 模式
    if (regs->ARM_pc & 1) {
        regs->ARM_pc &= ~1;
        regs->ARM_cpsr |= CPSR_T_MASK;
    } else {
        regs->ARM_cpsr &= ~CPSR_T_MASK;
    }

    regs->ARM_lr = 0;

    ptrace_set_regs(pid, regs);

    int status = 0;
    while (status != ((SIGSEGV << 8) | 0x7f)) {
        ptrace_continue(pid);
        waitpid(pid, &status, WUNTRACED);
        INFO("substatus: 0x%08x", status);
    }

    ptrace_get_regs(pid, regs);
}
```

### 在目标进程 mmap 分配一块内存空间

有了上面这些工具函数，我们就可以调用目标进程 libc 中的方法了，但为了能够调用一些以字符串作为参数的函数以及 shellcode 的注入，还需要 mmap 出一小块内存作为辅助

```c++
USE_REMOTE_FUNC(libc, mmap)

int main() {
    ...
    void *buffer = mmap_remote<void *>(
        pid, &regs, 
        (int64_t) nullptr, 
        (int64_t) getpagesize(), 
        (int64_t) PROT_READ | PROT_WRITE | PROT_EXEC,
        (int64_t) MAP_ANONYMOUS | MAP_PRIVATE,
        0L,
        0L
    );
    INFO("buffer: %p", buffer);
    ...
}
```

### 向目标进程地址空间写入数据

不少文章都用 `PTRACE_POKEDATA` 来改写目标进程的内存，每次只能写入几个字节，效率未免有些低下，我认为这里完全可以用 [`process_vm_writev`](https://man7.org/linux/man-pages/man2/process_vm_readv.2.html)，查看 man page 可知这个系统调用的权限检查和 `PTRACE_ATTACH` 是相同的：

* `process_vm_writev`

> Permission to read from or write to another process is governed by a ptrace access mode PTRACE_MODE_ATTACH_REALCREDS check; see ptrace(2).

* `PTRACE_ATTACH`

> Permission to perform a PTRACE_ATTACH is governed by a ptrace access mode PTRACE_MODE_ATTACH_REALCREDS check; see below.

因此既然能用 `ptrace` 附加到目标进程，也应该能用 `process_vm_writev` 改写其内存，这样在复制一些大数据时能节省不少时间

```c++
void ptrace_write_data(pid_t pid, void *addr, void *buffer, size_t bufsize) {
    iovec from {
        .iov_base = buffer,
        .iov_len = bufsize
    };
    iovec to {
        .iov_base = addr,
        .iov_len = bufsize
    };
    ssize_t count;
    if ((count = process_vm_writev(pid, &from, 1, &to, 1, 0)) == -1) {
        ERROR("write memory");
    }
    INFO("copied %zd bytes of data to target", count);
}
```

### 调用 `dlopen` 打开要注入的动态链接库

万事俱备，现在可以来调用 `dlopen` 了，只要加载了「坏蛋」动态库，`init_array` 中的函数就会自动执行，然后便可以做进一步的 inline hook、PLT hook 等操作

```c++
const char *INJECT = "/proc/self/cwd/hack.so";
ptrace_write_data(pid, (void *) buffer, (void *) INJECT, strlen(INJECT));

void *handle = dlopen_remote<void *>(
    pid, &regs,
    (int64_t) buffer,
    1L /* RTLD_LAZY */
);
INFO("handle: %p", handle);
```

### 恢复环境 & 解除附加

完成以上一系列操作之后，还需要恢复回原来的环境，让目标进程能够继续正常运行，我们需要：

* `munmap` 掉辅助空间

* `dlclose` 刚刚注入的动态库（防止在 maps 露出马脚，如需 hook 可另 mmap 匿名内存）

* 恢复寄存器上下文

* 解除 ptrace 状态

```c++
munmap_remote<int>(
    pid, &regs, 
    (int64_t) buffer,
    (int64_t) getpagesize()
);

dlclose_remote<int>(
    pid, &regs, 
    (int64_t) handle
);

ptrace_set_regs(pid, &backup_regs);
ptrace_detach(pid);
```

## 源代码

完整代码已上架 GitHub，可以在 Termux 环境中通过 `make` 命令运行。~~以及我并没有做任何诸如「绕过 dlopen 限制」的操作，所以在其他地方跑或许会出问题。~~ 参考 [这篇文章](https://windysha.github.io/2021/05/26/%E5%8F%A6%E4%B8%80%E7%A7%8D%E7%BB%95%E8%BF%87Android%E7%B3%BB%E7%BB%9F%E5%BA%93%E8%AE%BF%E9%97%AE%E9%99%90%E5%88%B6%E7%9A%84%E6%96%B9%E6%B3%95/) 所述的实现方式，调用 `dlopen` 时将 `LR` 寄存器的值设置为 libc 的基址，就可以实现绕过系统对 dlopen 函数的限制

现已支持对任意 ARM64 APP 进程注入代码，使用下面的命令运行：

```bash
make app PID=<PID>
```

{{< github repo="Mufanc/android-ptrace-inject">}}
