# 微信小程序自动化调试指南

> 以下内容已在本机 Windows 环境验证通过。

## 环境信息

| 项目 | 值 |
|------|-----|
| 开发者工具路径 | `C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat` |
| 自动化端口 | 9420 |
| Node.js | v24+ |
| 测试库 | `miniprogram-automator@0.12.1` |

## 前置条件

1. 微信开发者工具已安装并登录
2. 设置 → 安全设置 → **服务端口** 已开启
3. 目标小程序项目已通过开发者工具**导入并打开**

## 操作步骤

### 1. 启动自动化模式

```powershell
$cli = "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"
& $cli auto --project "你的项目路径" --auto-port 9420
```

验证端口就绪（轮询，不要固定 sleep）：

```powershell
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (netstat -ano | Select-String ":9420" | Where-Object { $_ -match "LISTENING" }) {
        Write-Host "Port ready"
        break
    }
}
```

### 2. 安装测试库

```powershell
npm init -y
npm install miniprogram-automator@0.12.1
```

### 3. 编写测试脚本

```javascript
const automator = require('miniprogram-automator')

// 关键：绕过版本检查（开发者工具版本比 automator 新时会报错）
const Launcher = require('miniprogram-automator/out/Launcher').default
Launcher.prototype.connect = async function(opts) {
    return await this.connectTool(opts)
}

async function run() {
    // 关键：用 wsEndpoint 而非 port 参数
    const mp = await automator.connect({
        wsEndpoint: 'ws://127.0.0.1:9420'
    })

    try {
        const page = await mp.reLaunch('/pages/index/index')
        await page.waitFor(500)

        // 用 CSS 选择器找元素
        const title = await page.$('.title')
        console.log('Title:', await title.text())

        // 点击按钮
        const btn = await page.$('[data-testid="btn-add"]')
        await btn.tap()
        await page.waitFor(300)

        // 获取文字验证
        const counter = await page.$('.counter text')
        console.log('Counter:', await counter.text())
    } finally {
        await mp.close()
    }
}

run()
```

### 4. 运行

```powershell
node test/smoke.js
```

## 踩坑记录

| 问题 | 原因 | 解决 |
|------|------|------|
| `connect` 报错 | 用了 `port` 参数 | 改用 `wsEndpoint: 'ws://127.0.0.1:9420'` |
| `checkVersion` 失败 | automator 版本落后于开发者工具 | monkey-patch 跳过版本检查（见上方代码） |
| `reLaunch` 卡住 | 项目未在开发者工具中导入 | 先用 `cli.bat open --project <path>` 导入 |
| 端口 9420 拒绝连接 | 自动化模式未启动 | 先执行 `cli.bat auto`，轮询端口就绪后再连接 |
| 找不到元素 | 依赖不稳定的 class | 用 `data-testid` 或 `id` 做选择器 |
