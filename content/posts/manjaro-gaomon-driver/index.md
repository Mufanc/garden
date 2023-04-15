+++
title = 'Manjaro 安装高漫数位板驱动'
summary = '设备型号：Gaomon Tablet 1060Pro'
date = 2023-04-14T20:58:05+08:00
slug = '533626f5'
tags = []
categories = []
draft = false
+++

为什么买了个数位板呢？我也不知道。

但还是买下来了，这板子支持 Android、Windows 和 Mac，唯独 Linux 照样是被官方抛弃的，并没有提供的驱动程序。

但好在我们有万能的社区，[DIGImend](https://github.com/DIGImend/digimend-kernel-drivers) 项目旨在改进 Linux 对通用图形输入板的支持，是用于 Linux 内核的图形输入板驱动程序的集合

首先看看设备信息：

```shell { hl_lines=[4] }
> lsusb
Bus 004 Device 001: ID 1d6b:0003 Linux Foundation 3.0 root hub
Bus 003 Device 007: ID 2d99:e008 Edifier Technology Co.,Ltd HECATE G1 GAMING HEADSET
Bus 003 Device 006: ID 256c:0064 GAOMON Gaomon Tablet_1060Pro
Bus 003 Device 005: ID 05e3:0610 Genesys Logic, Inc. Hub
Bus 003 Device 003: ID 258a:002a SINO WEALTH Gaming KB 
Bus 003 Device 002: ID 1ea7:0066 SHARKOON Technologies GmbH [Mediatrack Edge Mini Keyboard]
Bus 003 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub
Bus 002 Device 001: ID 1d6b:0003 Linux Foundation 3.0 root hub
Bus 001 Device 004: ID 8087:0032 Intel Corp. AX210 Bluetooth
Bus 001 Device 003: ID 1462:7c94 Micro Star International MYSTIC LIGHT 
Bus 001 Device 002: ID 05e3:0608 Genesys Logic, Inc. Hub
Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub
```

在项目中搜索一下，我这个型号的数位板是能够支持的，但截至撰写本文时 [这个 PR](https://github.com/DIGImend/digimend-kernel-drivers/pull/644) 还没合并，所以直接拉取作者的分支：

```bash
git clone https://github.com/inochisa/digimend-kernel-drivers -b huion-kd200
```

编译之前先装 dkms：

```bash
paru -S dkms
```

然后就可以开始编译了：

```bash
cd digimend-kernel-drivers
sudo make dkms_install
```

如果没安装对应的内核头文件，编译是会报错的，这时 `paru -S linux-headers` 然后选择对应的内核版本即可，安装完成后重启系统，不出意外板子应该已经能正常使用啦~

![](./hello-world.png)
