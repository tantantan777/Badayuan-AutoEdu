// main.js
const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const Store = require('electron-store');
const fs = require('fs');
const store = new Store();
let mainWindow;
let tray = null;
let progressTimer = null;
let currentLearningResourceId = null;

// 确保应用程序只能运行一个实例
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 如果无法获得锁，说明已经有一个实例在运行，退出当前实例
  app.quit();
} else {
  // 监听第二个实例的启动事件
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 如果用户尝试启动第二个实例，我们应该聚焦到第一个实例的窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // ========== 工具函数与业务函数 ========== //

  function log(msg) {
    if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      try {
        mainWindow.webContents.send('log', msg);
      } catch (e) {
        console.log('[log fallback][send error]', msg, e);
      }
    } else {
      console.log('[log fallback]', msg);
    }
  }

  // 工具函数：生成3-7秒的随机延时
  function randomDelay() {
    return 3000 + Math.floor(Math.random() * 4000); // 3000~7000ms
  }

  // 启动定时器函数，每秒推送当前学习中课件的进度
  function startProgressTimer(page, mainWindow) {
    if (progressTimer) clearInterval(progressTimer);
    let lastLearned = null;
    progressTimer = setInterval(async () => {
      if (!currentLearningResourceId) return;
      try {
        // 获取当前学习中课件的进度
        const result = await page.evaluate((rid) => {
          const li = document.querySelector('.video_list .kecheng_li[data-resourceid="' + rid + '"]');
          if (!li) return null;
          const learned = Number(li.getAttribute('data-secondslearned')) || 0;
          const total = Number(li.getAttribute('data-totalcount')) || 0;
          let status = '未学习';
          const finishSpan = li.querySelector('.bofang_list_name_wanchengdu');
          if (finishSpan && finishSpan.textContent.includes('已学完')) status = '已学完';
          else if (finishSpan && finishSpan.textContent.includes('学习中')) status = '学习中';
          else if (total === learned && total > 0) status = '已学完';
          else if (learned > 0) status = '学习中';
          return { resourceid: rid, learned, total, status };
        }, currentLearningResourceId);
        if (result) {
          // 计算剩余未观看课件总时长
          const courseList = await page.evaluate(() => {
            function formatDuration(sec) {
              sec = Number(sec) || 0;
              const h = String(Math.floor(sec / 3600)).padStart(2, '0');
              const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
              const s = String(sec % 60).padStart(2, '0');
              return h + ':' + m + ':' + s;
            }
            const lis = Array.from(document.querySelectorAll('.video_list .kecheng_li'));
            const courseList = [];
            lis.forEach(li => {
              const total = Number(li.getAttribute('data-totalcount')) || 0;
              const learned = Number(li.getAttribute('data-secondslearned')) || 0;
              const finishSpan = li.querySelector('.bofang_list_name_wanchengdu');
              let status = '未学习';
              if (finishSpan && finishSpan.textContent.includes('已学完')) status = '已学完';
              else if (finishSpan && finishSpan.textContent.includes('学习中')) status = '学习中';
              else if (total === learned && total > 0) status = '已学完';
              else if (learned > 0) status = '学习中';
              let name = '';
              const nameDiv = li.querySelector('.bofang_list_name_title');
              if (nameDiv) name = nameDiv.textContent.trim();
              courseList.push({
                status: status,
                name: name,
                duration: formatDuration(total),
                resourceid: li.getAttribute('data-resourceid'),
                learned: learned
              });
            });
            return courseList;
          });
          // 计算总时长、已学完时长
          function timeToSec(str) {
            if (!str) return 0;
            const parts = str.split(':').map(Number);
            if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
            if (parts.length === 2) return parts[0]*60 + parts[1];
            return 0;
          }
          const totalDurationSec = courseList.reduce((sum, item) => sum + timeToSec(item.duration), 0);
          const finishedCourseTotalSeconds = courseList.filter(item => item.status === '已学完').reduce((sum, item) => sum + timeToSec(item.duration), 0);
          const remainSeconds = totalDurationSec - finishedCourseTotalSeconds - result.learned;
          // 计算本节课总时长
          let currentTotalSeconds = 0;
          const currentCourse = courseList.find(item => item.resourceid === result.resourceid);
          if (currentCourse) currentTotalSeconds = timeToSec(currentCourse.duration);
          // 预计完成时间 = 当前北京时间 + (本节课总时长-本节课已观看时长)
          const now = new Date();
          const finishTime = new Date(now.getTime() + (currentTotalSeconds - result.learned) * 1000);
          const finishTimeStr = finishTime.toTimeString().slice(0,8);
          mainWindow.webContents.send('update-current-learned', { resourceid: result.resourceid, learned: result.learned, remainSeconds, finishTimeStr });
          // 检测课件切换（已观看时长从非0变为0）
          if (lastLearned !== null && result.learned === 0 && lastLearned > 0) {
            // 课件切换，刷新课件列表
            const courseList = await page.evaluate(() => {
              function formatDuration(sec) {
                sec = Number(sec) || 0;
                const h = String(Math.floor(sec / 3600)).padStart(2, '0');
                const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
                const s = String(sec % 60).padStart(2, '0');
                return h + ':' + m + ':' + s;
              }
              const lis = Array.from(document.querySelectorAll('.video_list .kecheng_li'));
              const courseList = [];
              lis.forEach(li => {
                const total = Number(li.getAttribute('data-totalcount')) || 0;
                const learned = Number(li.getAttribute('data-secondslearned')) || 0;
                const finishSpan = li.querySelector('.bofang_list_name_wanchengdu');
                let status = '未学习';
                if (finishSpan && finishSpan.textContent.includes('已学完')) status = '已学完';
                else if (finishSpan && finishSpan.textContent.includes('学习中')) status = '学习中';
                else if (total === learned && total > 0) status = '已学完';
                else if (learned > 0) status = '学习中';
                let name = '';
                const nameDiv = li.querySelector('.bofang_list_name_title');
                if (nameDiv) name = nameDiv.textContent.trim();
                courseList.push({
                  status: status,
                  name: name,
                  duration: formatDuration(total),
                  resourceid: li.getAttribute('data-resourceid'),
                  learned: learned
                });
              });
              return courseList;
            });
            mainWindow.webContents.send('update-course-list', { courseList });
          }
          lastLearned = result.learned;
          // 如果已学完，自动切换到下一个学习中课件
          if (result.status === '已学完') {
            const courseList = await page.evaluate(() => {
              const lis = Array.from(document.querySelectorAll('.video_list .kecheng_li'));
              return lis.map(li => {
                const resourceid = li.getAttribute('data-resourceid');
                const total = Number(li.getAttribute('data-totalcount')) || 0;
                const learned = Number(li.getAttribute('data-secondslearned')) || 0;
                let status = '未学习';
                const finishSpan = li.querySelector('.bofang_list_name_wanchengdu');
                if (finishSpan && finishSpan.textContent.includes('已学完')) status = '已学完';
                else if (finishSpan && finishSpan.textContent.includes('学习中')) status = '学习中';
                else if (total === learned && total > 0) status = '已学完';
                else if (learned > 0) status = '学习中';
                return { resourceid, status };
              });
            });
            const next = courseList.find(c => c.status === '学习中');
            if (next) {
              currentLearningResourceId = next.resourceid;
            } else {
              clearInterval(progressTimer);
              progressTimer = null;
              currentLearningResourceId = null;
            }
          }
        }
      } catch (e) {
        // 忽略错误
      }
    }, 1000);
  }

  function stopProgressTimer() {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = null;
    currentLearningResourceId = null;
  }

  // 二维码弹窗守护与倒计时（重写为每秒检测可见性，状态变化时触发操作，使用isVisible）
  async function handleFaceQRCode(page, log, mainWindow) {
    let lastQRCodeVisible = false;
    let timer = null;
    while (true) {
      await page.waitForTimeout(1000);
      const qrVisible = await page.isVisible('#faceQRCode');

      if (qrVisible && !lastQRCodeVisible) {
        // 二维码弹窗刚刚出现
        log('检测到二维码弹窗出现，请微信扫码进行人脸识别。');
        mainWindow.show();
        // 推送二维码图片
        const qrImg = await page.$('#faceQRCode');
        const qrSrc = await qrImg.getAttribute('src');
        const base64Data = qrSrc.replace(/^data:image\/png;base64,/, '');
        mainWindow.webContents.send('face-qrcode', base64Data);

        // 启动倒计时监控
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        // 启动新定时器，每秒获取页面上的实际倒计时
        timer = setInterval(async () => {
          try {
            const timerText = await page.$eval('.heartCheckTimer', el => el.textContent.trim());
            mainWindow.webContents.send('qrcode-timer', timerText);
            
            // 检查是否过期（0分0秒）
            if (timerText.includes('0分0秒') || timerText.includes('0分 0秒')) {
              log('二维码已过期，正在自动刷新...');
              // 点击刷新按钮
              await page.click('#btnReloadQRCode');
              // 等待新二维码加载
              await page.waitForTimeout(1000);
              // 重新获取二维码
              const newQrImg = await page.$('#faceQRCode');
              const newQrSrc = await newQrImg.getAttribute('src');
              const newBase64Data = newQrSrc.replace(/^data:image\/png;base64,/, '');
              mainWindow.webContents.send('face-qrcode', newBase64Data);
              log('二维码已刷新，请微信扫码进行人脸识别。');
            }
          } catch (e) {
            // 如果获取失败，可能是二维码已经消失
            clearInterval(timer);
            timer = null;
          }
        }, 1000);
      }

      if (!qrVisible && lastQRCodeVisible) {
        // 二维码弹窗刚刚消失（人脸识别成功）
        log('二维码弹窗消失，自动隐藏窗口到托盘。');
        mainWindow.hide();
        // 清理倒计时定时器
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        // 推送 remain=-1，前端显示"人脸识别成功"
        mainWindow.webContents.send('qrcode-timer', -1);
        // 主动推送一次最新的本节课已观看时长
        if (currentLearningResourceId) {
          try {
            const result = await page.evaluate((rid) => {
              const li = document.querySelector('.video_list .kecheng_li[data-resourceid="' + rid + '"]');
              if (!li) return null;
              const learned = Number(li.getAttribute('data-secondslearned')) || 0;
              return { resourceid: rid, learned };
            }, currentLearningResourceId);
            if (result) {
              mainWindow.webContents.send('update-current-learned', { resourceid: result.resourceid, learned: result.learned });
            }
          } catch (e) {}
        }
      }

      lastQRCodeVisible = qrVisible;
    }
  }

  // ========== 主流程 ========== //

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1800,
      height: 1000,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
      icon: path.join(__dirname, 'icon.ico'),
      autoHideMenuBar: true,
    });
    mainWindow.loadFile('index.html');
    createTray();

    // 拦截关闭事件，点击X时最小化到托盘而不是退出
    mainWindow.on('close', (event) => {
      if (!app.isQuiting) {
        event.preventDefault();
        mainWindow.hide();
        mainWindow.setSkipTaskbar(true);
      }
      // 否则允许退出
    });
  }

  function createTray() {
    if (tray) return;
    tray = new Tray(path.join(__dirname, 'icon.ico'));
    const contextMenu = Menu.buildFromTemplate([
      { label: '显示主界面', click: () => { mainWindow.show(); } },
      { label: '退出', click: () => { app.isQuiting = true; app.quit(); } }
    ]);
    tray.setToolTip('四川省八大员继续教育自动化助手');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
      mainWindow.show();
    });
  }

  // 主自动化流程
  async function startAutomation(config) {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({
      headless: true,
      executablePath: config.browserPath
    });
    const page = await browser.newPage();

    // 1. 打开登录页面
    const loginUrl = 'http://www.sczjrcfw.cn/member/index/login?url=';
    const feedbackUrl = 'http://www.sczjrcfw.cn/member/MemberLogin';
    const successUrl = 'http://www.sczjrcfw.cn/member/index';

    while (true) {
      await page.goto(loginUrl);
      await page.waitForLoadState('networkidle');
      log('正在获取验证码...');

      // 2. 获取验证码图片并推送前端
      try {
        const captchaElement = await page.waitForSelector('img[alt="captcha"]');
        const imgPath = path.join(app.getPath('userData'), 'captcha.jpg');
        await captchaElement.screenshot({ path: imgPath });
        const imgData = fs.readFileSync(imgPath).toString('base64');
        mainWindow.webContents.send('show-captcha', imgData);
        log('请输入注册手机号、密码和图形验证码。');
      } catch (e) {
        log('未能找到验证码图片，网站可能修改HTML结构或网站未正常打开，请退出程序重新打开。');
        return;
      }

      // 3. 等待用户输入表单
      const { phone, pass, captcha } = await new Promise(resolve => { userInputResolver = resolve; });

      // 4. 自动填写并提交表单
      await page.fill('#login_user', phone);
      await page.fill('#login_pass', pass);
      await page.fill('#captcha', captcha);
      await page.click('button.btn.btn-primary');
      log('正在登录...');

      // 5. 等待反馈并判定
      let feedbackText = '';
      let loginSuccess = false;
      try {
        await page.waitForURL(feedbackUrl);
        try {
          feedbackText = await page.$eval('p.success', el => el.textContent.trim());
        } catch (e) { feedbackText = ''; }
        try {
          const jumpLink = await page.$('#href');
          if (jumpLink) await jumpLink.click();
        } catch (e) {}
      } catch (e) {}
      const currentUrl = page.url();
      if (feedbackText === '登录成功' || currentUrl === successUrl) {
        log('登陆成功！');
        loginSuccess = true;
        mainWindow.webContents.send('disable-send-btn');

        try {
          // 1. 延迟3-7秒后点击"我的继续教育"
          await page.waitForTimeout(randomDelay());
          log('正在点击"我的继续教育"...');
          await page.click('#MENU_CONTINUE_EDU');

          // 2. 等待页面跳转到学员中心
          log('等待页面跳转到学员中心...');
          await page.waitForURL('https://scbdystudent.etledu.com/PersonalCenter/StudentIndex?type=1');

          // 3. 跳转成功后再等待3-7秒
          await page.waitForTimeout(randomDelay());

          // 4. 关闭弹窗
          log('正在关闭小程序弹窗...');
          await page.click('.layui-layer-setwin .layui-layer-ico.layui-layer-close1');

          // 5. 延迟3-7秒，点击"我的学习"
          await page.waitForTimeout(randomDelay());
          log('正在点击"我的学习"...');
          await page.click('a[target="/PersonalCenter/MyTrain"]');

          // 6. 延迟3-7秒再点击"开始学习"
          await page.waitForTimeout(randomDelay());
          log('正在点击"开始学习"...');
          await page.click('div.layui-btn.layui-btn-sm.layui-btn-normal.blue');

          // 7. 延迟3-7秒，点击"我知道了"
          await page.waitForTimeout(randomDelay());
          log('正在点击"我知道了"按钮...');
          await page.click('div.iknow');

          // 先获取课件列表并推送，带详细日志
          try {
            // log('准备获取课件列表...'); // 已精简，移除
            // log('课件列表DOM已出现，准备evaluate...'); // 已精简，移除
            await page.waitForSelector('.video_list .kecheng_li', { state: 'attached', timeout: 10000 });
            // log('课件列表DOM已出现，准备evaluate...'); // 已精简，移除
            const courseStats = await page.evaluate(() => {
              try {
                function formatDuration(sec) {
                  sec = Number(sec) || 0;
                  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
                  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
                  const s = String(sec % 60).padStart(2, '0');
                  return h + ':' + m + ':' + s;
                }
                const lis = Array.from(document.querySelectorAll('.video_list .kecheng_li'));
                const courseList = [];
                lis.forEach(li => {
                  const total = Number(li.getAttribute('data-totalcount')) || 0;
                  const learned = Number(li.getAttribute('data-secondslearned')) || 0;
                  const finishSpan = li.querySelector('.bofang_list_name_wanchengdu');
                  let status = '未学习';
                  if (finishSpan && finishSpan.textContent.includes('已学完')) status = '已学完';
                  else if (finishSpan && finishSpan.textContent.includes('学习中')) status = '学习中';
                  else if (total === learned && total > 0) status = '已学完';
                  else if (learned > 0) status = '学习中';
                  let name = '';
                  const nameDiv = li.querySelector('.bofang_list_name_title');
                  if (nameDiv) name = nameDiv.textContent.trim();
                  courseList.push({
                    status: status,
                    name: name,
                    duration: formatDuration(total),
                    resourceid: li.getAttribute('data-resourceid'),
                    learned: learned
                  });
                });
                return courseList;
              } catch (e) {
                return { error: e && e.stack ? e.stack : e };
              }
            });
            // log('课件列表evaluate结果：' + JSON.stringify(courseStats)); // 已精简，移除详细内容
            // 取学习中课件的已观看时长
            const learning = Array.isArray(courseStats) ? courseStats.find(c => c.status === '学习中') : null;
            const currentWatchedSeconds = learning ? learning.learned : 0;
            mainWindow.webContents.send('update-course-list', { courseList: courseStats, currentWatchedSeconds });
            log('课件列表已更新。');
            // 记录当前学习中课件的resourceid并启动定时器
            if (learning) {
              currentLearningResourceId = learning.resourceid;
              if (!progressTimer) startProgressTimer(page, mainWindow);
            } else {
              stopProgressTimer();
            }
          } catch (e) {
            log('课件列表更新失败：' + (e && e.stack ? e.stack : e));
          }

          // 再获取二维码并推送（不调用守护进程）
          try {
            await page.waitForSelector('#faceQRCode');
            const qrImg = await page.$('#faceQRCode');
            const qrSrc = await qrImg.getAttribute('src');
            const base64Data = qrSrc.replace(/^data:image\/png;base64,/, '');
            mainWindow.webContents.send('face-qrcode', base64Data);
            log('请打开微信扫描右侧二维码进行人脸识别。');
            
            // 启动二维码倒计时监控
            let timer = setInterval(async () => {
              try {
                // 先检查二维码是否还可见
                const qrVisible = await page.isVisible('#faceQRCode');
                if (!qrVisible) {
                  // 二维码消失，说明人脸识别成功
                  clearInterval(timer);
                  timer = null;
                  mainWindow.webContents.send('qrcode-timer', -1);
                  log('人脸识别成功。');
                  return;
                }

                const timerText = await page.$eval('.heartCheckTimer', el => el.textContent.trim());
                mainWindow.webContents.send('qrcode-timer', timerText);
                
                // 检查是否过期（0分0秒）
                if (timerText.includes('0分0秒') || timerText.includes('0分 0秒')) {
                  log('二维码已过期，正在自动刷新...');
                  // 点击刷新按钮
                  await page.click('#btnReloadQRCode');
                  // 等待新二维码加载
                  await page.waitForTimeout(1000);
                  // 重新获取二维码
                  const newQrImg = await page.$('#faceQRCode');
                  const newQrSrc = await newQrImg.getAttribute('src');
                  const newBase64Data = newQrSrc.replace(/^data:image\/png;base64,/, '');
                  mainWindow.webContents.send('face-qrcode', newBase64Data);
                  log('二维码已刷新，请微信扫码进行人脸识别。');
                }
              } catch (e) {
                // 如果获取失败，可能是二维码已经消失
                clearInterval(timer);
                timer = null;
                // 检查二维码是否还在
                const qrVisible = await page.isVisible('#faceQRCode');
                if (!qrVisible) {
                  // 二维码消失，立即推送 remain=-1
                  mainWindow.webContents.send('qrcode-timer', -1);
                  log('人脸识别成功。');
                }
              }
            }, 1000);
          } catch (e) {
            log('二维码推送失败：' + (e && e.stack ? e.stack : e));
          }

          // 8. 延迟3-7秒，等待人脸识别成功后再启动二维码守护进程
          await page.waitForTimeout(randomDelay());
          // 等待二维码消失（人脸识别成功）
          let faceDone = false;
          let remain = 120;
          while (remain >= 0) {
            await page.waitForTimeout(1000);
            remain--;
            const qrVisible = await page.isVisible('#faceQRCode');
            if (!qrVisible) {
              log('按照历史播放进度，继续开始播放视频。');
              faceDone = true;
              break;
            }
          }
          if (faceDone) {
            // 人脸识别成功后再启动二维码守护进程
            await handleFaceQRCode(page, log, mainWindow);
          }
        
        } catch (e) {
        }
      } else if (feedbackText === '没有用户') {
        log('手机号输入错误，请重新输入。');
      } else if (feedbackText === '密码错误') {
        log('手机号或密码错误，请重新输入。');
      } else if (feedbackText === '验证码错误') {
        log('验证码错误，请重新输入。');
      } else {
        log('判定结果：登录失败或验证码错误，请重新输入。');
      }

      // 登录成功则跳出循环，失败则重新获取验证码
      if (loginSuccess) break;
    }
  }

  // ========== 事件监听 ========== //

  // 监听前端"发送"按钮输入
  let userInputResolver = null;
  ipcMain.handle('user-input', async (event, data) => {
    if (userInputResolver) {
      userInputResolver(data);
      userInputResolver = null;
    }
  });

  // 监听保存配置
  ipcMain.handle('save-config', (event, config) => {
    store.set('userConfig', config);
    return true;
  });

  // 监听读取配置
  ipcMain.handle('get-config', () => {
    return store.get('userConfig') || {};
  });

  // 启动自动化
  ipcMain.handle('start-playwright', async (event, config) => {
    startAutomation(config);
    return true;
  });

  ipcMain.on('minimize-window', (event) => {
    if (mainWindow) {
      setTimeout(() => {
        mainWindow.hide();
        mainWindow.setSkipTaskbar(true);
      }, randomDelay());
    }
  });

  ipcMain.on('restore-window', (event) => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.setSkipTaskbar(false);
    }
  });

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // 全局未处理Promise异常捕获
  process.on('unhandledRejection', (reason, p) => {
    console.error('未处理的Promise异常:', reason);
  });
} 