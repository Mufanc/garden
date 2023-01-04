+++
title = '{{ replace .Name "-" " " | title }}'
summary = ''
date = {{ .Date }}
slug = '{{ substr (md5 (printf "%s%s" .Date (replace .TranslationBaseName "-" " " | title))) 0 8 }}'
tags = []
categories = []
draft = true
+++
