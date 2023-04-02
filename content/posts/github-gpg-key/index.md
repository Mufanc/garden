+++
title = '为 GitHub 配置 GPG 签名'
summary = '给提交加上 Verified 小绿标'
date = 2023-04-01T18:20:09+08:00
slug = 'cf8d1e6e'
tags = []
categories = []
draft = false
+++

GitHub 似乎很久以前就支持 GPG 密钥了，然而我使用 GitHub 将近三年，却还没为账户添加 GPG 密钥，实在有些不成体统

## Git 的「漏洞」

提交代码之前，Git 会要求我们设置好用户名和邮箱。但事实上，即便我们设置了别人的用户名和邮箱，GitHub 也不会拒绝推送（也没有理由拒绝推送），这样一来，似乎我们便可以伪装成其他人向仓库提交代码，比如下面这样：

![](./fake-commit.png)

能够任意伪造提交者，显然不利于仓库的维护和管理，因此，为了使代码更加可信，确保是由作者本人提交的，Github 等代码托管平台纷纷支持了 GPG 签名，GPG 签名与帐号绑定，GitHub 只信任由作者本人配置的 GPG 公钥

## 配置 GPG 签名

首先需要安装 gnupg：

```shell
> paru -S gnupg
> gpg --version  # 验证安装
gpg (GnuPG) 2.2.41
libgcrypt 1.10.1-unknown
Copyright (C) 2022 g10 Code GmbH
License GNU GPL-3.0-or-later <https://gnu.org/licenses/gpl.html>
This is free software: you are free to change and redistribute it.
There is NO WARRANTY, to the extent permitted by law.

Home: /home/mufanc/.gnupg
Supported algorithms:
Pubkey: RSA, ELG, DSA, ECDH, ECDSA, EDDSA
Cipher: IDEA, 3DES, CAST5, BLOWFISH, AES, AES192, AES256, TWOFISH,
        CAMELLIA128, CAMELLIA192, CAMELLIA256
Hash: SHA1, RIPEMD160, SHA256, SHA384, SHA512, SHA224
Compression: Uncompressed, ZIP, ZLIB, BZIP2
```

生成密钥对，跟着命令行提示一步步走即可，最后会要求输入两次密码确认：

```shell
> gpg --full-generate-key
```

密钥对生成完毕以后，还需要将公钥添加到 GitHub 上，使用下面的命令列出所有本地密钥，能够看到刚刚生成的公钥出现在这里：

```shell
> gpg --list-keys
/home/mufanc/.gnupg/pubring.kbx
-------------------------------
pub   rsa3072 2023-04-01 [SC]
      F1A39B8267452D20FE32E3FA0540C5B9184678BC
uid           [ultimate] Mufanc <mufanc.xyz@gmail.com>
sub   rsa3072 2023-04-01 [E]

> gpg --armor --export $GPG_KEY_ID  # 查询公钥内容
-----BEGIN PGP PUBLIC KEY BLOCK-----
****************************************************************
****************************************************************
****
-----END PGP PUBLIC KEY BLOCK-----
```

用命令导出公钥内容，得到一串 base64 字符串（此处已替换为 `*`），再参照 [官方文档](https://docs.github.com/zh/authentication/managing-commit-signature-verification/adding-a-gpg-key-to-your-github-account) 的说明，把这段公钥添加到 GitHub 上即可

最后一步，配置 Git 提交代码时使用 GPG 密钥签名：

```shell
> git config --global user.signingkey $GPG_KEY_ID
> git config --global commit.gpgsign true
```

此时再向仓库提交代码，右侧就会出现一个 `Verified` 小绿标啦：

![](./signed-commit.png)

## 报错？

提交代码时，有可能会遇到 `gpg: signing failed: Inappropriate ioctl for device` 错误，只需要将下面这行添加到 `~/.zshrc` 即可解决：

```bash
export GPG_TTY=$(tty)
```

但是上面的方案有个问题，如果在 IDE 中提交代码，IDE 集成的 Git 没有一个合适的 tty 来供我们输入密码，导致 commit 失败。所以这里使用第二套方案，配置 `pinentry` 以从弹出对话框中输入密码：

* 安装 `pinentry`

```shell
> paru -S pinentry
```

* 配置 `gpg-agent`

在 `~/.gnupg/gpg-agent.conf` 中添加以下内容，我这里是 KDE 桌面环境，所以用的 `pinentry-qt`，Gnome 用户似乎应该换成 `pinentry-gtk-2`（？

```text
# 密码缓存有效期（秒）
default-cache-ttl 3600

# 用于输入密码的窗口程序
pinentry-program /usr/bin/pinentry-qt 
```

然后使用命令 `gpgconf --kill gpg-agent` 杀死 `gpg-agent`，使其下次启动时重新加载配置，可以通过下面的命令来测试：

```shell
> echo | gpg -ase -r $GPG_KEY_ID
```

如果能够正常弹出对话框，则说明一切正常，可以愉快地写代码啦~
