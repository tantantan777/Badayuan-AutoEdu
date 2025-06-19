# 四川省八大员继续教育自动化助手

<div align="center">
  <img src="icon.ico" width="128" height="128" alt="项目Logo">
  <p>基于 Electron + Playwright 的高效学习辅助工具</p>
  
  ![版本](https://img.shields.io/badge/版本-1.0.4-blue)
  ![协议](https://img.shields.io/badge/协议-MIT-green)
  ![平台](https://img.shields.io/badge/平台-Windows-orange)
</div>

## 🆕 更新日志
### v1.0.4 (2024-06-19)
- ✅ 添加使用说明和风险告知弹窗
- ✅ 修复播放完成后的文本显示

### v1.0.3 (2024-06-17)
- ✅ 修复日志重复输出问题
- ✅ 修复初次人脸识别成功后不自动隐藏问题
- ✅ 增加明显的暂停和播放文字特效
- ✅ 增加部分日志
- ✅ 修改版本号

### v1.0.2 (2024-06-10)
- ✅ 修复二维码守护功能失效问题
- ✅ 优化二维码刷新和过期处理逻辑
- ✅ 增强错误处理和自动恢复能力
- ✅ 新增课程列表手动刷新功能
- ✅ 更新依赖库到最新版本

## 📋 项目简介

本项目是专为四川省八大员继续教育设计的自动化学习工具，采用 Electron + Playwright 技术栈开发，旨在提高学习效率。

- ✅ **全自动化流程**：支持自动登录、自动刷课、二维码人脸识别自动处理
- 📊 **实时数据同步**：前端进度、课件列表、二维码状态实时更新
- 📦 **一键打包绿色版**：免安装、解压即用，适合U盘便携使用
- 🧹 **零残留设计**：无注册表写入、无系统残留、隐私保护

### 开发背景

作为一名资料员，日常工作中需要频繁切换多个专业软件（如 CAD、Excel 等）和办公应用。在使用 Alt+Tab 快速切换窗口时，若同时打开浏览器播放视频，及其容易切换到浏览器。
而且有时候会忘记人脸识别，导致视频一直挂起但未播放。

基于这一实际需求，本项目应运而生。其核心设计理念是：
- 🎯 **后台静默运行**：避免窗口切换时的误操作
- 🔔 **智能提醒**：人脸识别时自动弹窗提示
- 🔄 **自动化处理**：完成验证后自动隐藏，确保工作不被打断
- 💡 **简单高效**：一次配置，后续自动化处理，无需反复操作

虽然这是一个面向特定场景的工具，但相信能为有相似需求的同行提供便利。

### 使用说明

1. **首次配置**
   - 启动程序，根据日志提示输入登录信息
   - 完成初次人脸识别验证

2. **自动化流程**
   - 系统自动完成课程选择与播放
   - 需要人脸识别时自动弹窗提示
   - 完成验证后自动隐藏窗口，继续后台运行
   - 课程结束后自动切换下一课程

3. **智能提醒**
   - 到达验证时间点自动唤醒窗口
   - 完成人脸识别后自动恢复后台状态
   - 全程无需手动监控课程进度

## 💻 界面布局

- **左侧区域**：系统日志、浏览器配置、账号管理、验证码处理
- **中央区域**：二维码显示、倒计时、当前课程进度详情
- **右侧区域**：课件列表与状态指示器

## 🔧 使用指南

### 开发环境配置

```bash
# 安装项目依赖
npm install

# 启动开发调试环境
npm start
```

### 打包绿色版

```bash
# 一键打包便携版
npm run pack:green
```

打包结果位于 `dist/win-unpacked` 目录，可直接压缩分发。

## 📦 绿色版分发指南

- 分发内容：仅需分发 `dist` 文件夹内的exe文件或`dist/win-unpacked`文件进行压缩产生的压缩包
- 使用方法：用户（解压后）双击 exe 文件直接运行
- 环境要求：Windows 10/11，无需额外安装运行库
- 数据存储：所有配置与数据均保存在程序目录，便于备份与迁移

## 🔍 系统要求

对于二次开发使用者的要求：
- **操作系统**：Windows 10/11
- **开发环境**：Node.js 18+ (推荐 LTS 版本)
- **网络要求**：首次打包需访问 GitHub 下载 Electron

## ❓ 常见问题

| 问题描述 | 解决方案 |
|---------|---------|
| 打包过程下载失败 | 配置科学上网或使用国内镜像源 |
| 二维码图片显示异常 | 人脸识别成功后会自动隐藏，属正常现象 |
| 托盘退出无响应 | 已修复，右键托盘"退出"可正常关闭程序 |
| 绿色版与安装包区别 | 仅需分发 win-unpacked 目录，无需安装包 |

## 🧰 技术栈

- **前端框架**：Electron (v29.1.4)
- **自动化引擎**：Playwright (v1.44.0)
- **数据持久化**：electron-store (v8.1.0)
- **打包工具**：electron-builder (v24.13.3)

## 📝 其他说明

- 支持多账号管理与环境切换
- 详细日志记录，便于问题排查
- 数据本地存储，保护账号安全

## ⚖️ 开源协议

本项目采用 [MIT 许可证](https://opensource.org/licenses/MIT) 进行开源。

```
MIT License

Copyright (c) 2025-2026 四川省八大员继续教育自动化助手

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ⚠️ 免责声明

1. 本项目仅供个人学习与技术研究使用，**严禁用于商业用途**。
2. **严禁用于批量刷课、违法违规用途或规避正常学习流程**。
3. 严禁在未经授权的情况下广泛传播、分发或用于任何违反目标网站服务条款的行为。
4. 使用本软件造成的任何后果（包括但不限于账号封禁、学习记录无效等）由使用者本人承担。
5. 本项目开发者不对使用本软件产生的任何后果承担法律责任。
6. 如果您使用了本软件，即表示您已阅读并同意上述免责声明。

## 🧡 支持项目

如果本项目对您有所帮助，欢迎扫描下方二维码支持开发者继续完善本项目。

<div align="center">
  <p>微信赞赏码</p>
  <img src="微信收款码.jpg" width="200" height="200" alt="微信赞赏码">
</div>
<div align="center">
  <p>支付宝赞赏码</p>
  <img src="支付宝收款码.jpg" width="200" height="200" alt="支付宝赞赏码">
</div>
---

<div align="center">
  <p>如有问题或建议，欢迎提交 Issue 或 Pull Request</p>
  <p>©️ 2025-2026 八大员继续教育自动化助手</p>
</div> 