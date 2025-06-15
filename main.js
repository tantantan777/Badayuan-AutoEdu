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

  // ==================== 工具函数 ====================

  /**
   * 获取当前时间戳 [HH:MM:SS]
   * @returns {string} 格式化的时间戳
   */
  function getTimeStamp() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `[${h}:${m}:${s}]`;
  }

  /**
   * 日志记录函数
   * @param {string} msg - 日志消息
   */
  function log(msg) {
    // 添加静态变量用于跟踪最后一条日志
    if (!log.lastMessage) {
      log.lastMessage = '';
      log.lastTimestamp = '';
    }
    
    const timestamp = getTimeStamp();
    const logMsg = `${timestamp} ${msg}`;
    
    // 检查是否与上一条日志内容相同(忽略时间戳)
    if (msg === log.lastMessage) {
      return; // 跳过重复日志
    }
    
    // 更新最后一条日志信息
    log.lastMessage = msg;
    log.lastTimestamp = timestamp;
    
    if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      try {
        mainWindow.webContents.send('log', logMsg);
      } catch (e) {
        console.log('[log fallback][send error]', logMsg, e);
      }
    } else {
      console.log('[log fallback]', logMsg);
    }
  }

  /**
   * 生成随机延时（3-7秒）
   * @returns {number} 延时时间（毫秒）
   */
  function randomDelay() {
    return 3000 + Math.floor(Math.random() * 4000);
  }

  // ==================== 主要业务函数 ====================

  // ---------------------------------------------------------------------------
  /**
   * 获取并推送二维码
   * @param {Page} page - Playwright页面实例
   * @param {BrowserWindow} mainWindow - 主窗口实例
   * @returns {Promise<boolean>} 是否成功获取二维码
   */
  async function getAndPushQRCode(page, mainWindow) {
    try {
      const qrImg = await page.$('#faceQRCode');
      if (qrImg) {
        const qrSrc = await qrImg.getAttribute('src');
        const base64Data = qrSrc.replace(/^data:image\/png;base64,/, '');
        mainWindow.webContents.send('face-qrcode', base64Data);
        return true;
      }
      return false;
    } catch (e) {
      log('获取二维码图片失败: ' + e.message);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  /**
   * 刷新二维码
   * @param {Page} page - Playwright页面实例
   * @param {BrowserWindow} mainWindow - 主窗口实例
   * @returns {Promise<boolean>} 是否成功刷新二维码
   */
  async function refreshQRCode(page, mainWindow) {
    try {
      log('二维码已过期，正在自动刷新...');
      // 点击刷新按钮
      const refreshBtn = await page.$('#btnReloadQRCode');
      if (refreshBtn) {
        await refreshBtn.click();
        // 等待新二维码加载
        await page.waitForTimeout(1000);
        // 重新获取并推送二维码
        const success = await getAndPushQRCode(page, mainWindow);
        if (success) {
          log('二维码已刷新，请微信扫码进行人脸识别。');
          return true;
        }
      }
      return false;
    } catch (e) {
      log('刷新二维码失败: ' + e.message);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  /**
   * 处理二维码识别成功
   * @param {Page} page - Playwright页面实例
   * @param {BrowserWindow} mainWindow - 主窗口实例
   * @param {Function} callback - 成功后的回调函数
   */
  async function handleQRCodeSuccess(page, mainWindow, callback = null) {
    // 推送 remain=-1，前端显示"人脸识别成功"
    mainWindow.webContents.send('qrcode-timer', -1);
    log('人脸识别成功，3秒后自动隐藏窗口到托盘。');
    
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
      } catch (e) {
        log('获取已观看时长失败: ' + e.message);
      }
    }
    
    // 执行回调函数，启动守护进程
    if (typeof callback === 'function') {
      callback();
    }
  }

  // ---------------------------------------------------------------------------
  /**
   * 监控二维码倒计时
   * @param {Page} page - Playwright页面实例
   * @param {BrowserWindow} mainWindow - 主窗口实例
   * @returns {Promise<number>} 定时器ID
   */
  async function monitorQRCodeTimer(page, mainWindow) {
    let timer = setInterval(async () => {
      try {
        // 检查二维码是否还可见
        const qrVisible = await page.isVisible('#faceQRCode');
        if (!qrVisible) {
          // 二维码消失，说明人脸识别成功
          clearInterval(timer);
          timer = null;
          await handleQRCodeSuccess(page, mainWindow, () => {
            // 人脸识别成功后启动二维码守护进程
            setTimeout(() => {
              startQRCodeGuardian(page, mainWindow);
              log('二维码守护进程已启动，将监控人脸识别二维码弹窗');
            }, 3000);
          });
          return;
        }

        // 获取倒计时
        const timerElem = await page.$('.heartCheckTimer');
        if (timerElem) {
          const timerText = await timerElem.textContent();
          mainWindow.webContents.send('qrcode-timer', timerText);
          
          // 检查是否过期（0分0秒）
          if (timerText.includes('0分0秒') || timerText.includes('0分 0秒')) {
            // 避免重复调用刷新
            if (!monitorQRCodeTimer.isRefreshing) {
              monitorQRCodeTimer.isRefreshing = true;
              await refreshQRCode(page, mainWindow);
              // 设置一个短暂的延迟后重置刷新状态
              setTimeout(() => {
                monitorQRCodeTimer.isRefreshing = false;
              }, 2000);
            }
          }
        }
      } catch (e) {
        log('倒计时监控出错: ' + e.message);
        // 如果获取失败，可能是二维码已经消失
        clearInterval(timer);
        timer = null;
        
        // 再次检查二维码是否还在
        try {
          const qrVisible = await page.isVisible('#faceQRCode');
          if (!qrVisible) {
            await handleQRCodeSuccess(page, mainWindow, () => {
              // 人脸识别成功后启动二维码守护进程
              setTimeout(() => {
                startQRCodeGuardian(page, mainWindow);
                log('二维码守护进程已启动，将监控人脸识别二维码弹窗');
              }, 3000);
            });
          }
        } catch (err) {
          log('检查二维码可见性失败: ' + err.message);
        }
      }
    }, 1000);
    
    // 初始化刷新状态标志
    monitorQRCodeTimer.isRefreshing = false;
    
    return timer;
  }

  // ---------------------------------------------------------------------------
  /**
   * 初始化二维码处理
   * @param {Page} page - Playwright页面实例
   * @param {BrowserWindow} mainWindow - 主窗口实例
   * @returns {Promise<void>}
   */
  async function initializeQRCode(page, mainWindow) {
    try {
      // 1. 等待二维码元素出现
      await page.waitForSelector('#faceQRCode', { timeout: 10000 }).catch(() => {
        log('未检测到二维码元素，可能网站结构已变化或不需要人脸识别');
      });
      
      // 2. 检查二维码是否存在
      const qrExists = await page.$('#faceQRCode') !== null;
      if (!qrExists) {
        log('未找到二维码元素，跳过人脸识别步骤');
        return;
      }
      
      // 3. 获取并显示二维码
      const success = await getAndPushQRCode(page, mainWindow);
      if (success) {
        log('请打开微信扫描右侧二维码进行人脸识别。');
        mainWindow.show();
        mainWindow.focus();
      }
      
      // 4. 启动二维码倒计时监控
      const timer = await monitorQRCodeTimer(page, mainWindow);
      
      // 5. 设置超时处理
      setTimeout(async () => {
        const qrVisible = await page.isVisible('#faceQRCode').catch(() => false);
        if (qrVisible && timer) {
          log('人脸识别超时，将继续等待用户扫码。');
          // 继续等待用户扫码，不启动守护进程
        }
      }, 120000);
      
    } catch (e) {
      log('二维码处理失败：' + (e.message || e));
    }
  }

  // ---------------------------------------------------------------------------
  /**
   * 启动二维码守护进程
   * @param {Page} page - Playwright页面实例
   * @param {BrowserWindow} mainWindow - 主窗口实例
   */
  async function startQRCodeGuardian(page, mainWindow) {
    let lastQRCodeVisible = false;
    let timer = null;
    let initialDetectionTime = Date.now(); // 记录守护进程启动时间
    let lastQRCodeDetectionTime = 0; // 上次检测到二维码的时间
    
    log('二维码守护进程已启动，将监控人脸识别二维码弹窗');
    
    try {
      while (true) {
        try {
          // 每秒检查一次二维码是否可见
          await page.waitForTimeout(1000);
          
          // 使用try-catch包装isVisible调用，防止页面结构变化导致的错误
          let qrVisible = false;
          try {
            qrVisible = await page.isVisible('#faceQRCode');
          } catch (e) {
            // 忽略错误，继续循环
            continue;
          }

          if (qrVisible && !lastQRCodeVisible) {
            // 二维码弹窗刚刚出现
            const now = Date.now();
            // 避免在短时间内重复输出检测到二维码的日志(至少间隔10秒)
            if (now - lastQRCodeDetectionTime > 10000) {
              log('检测到二维码弹窗出现，请微信扫码进行人脸识别。');
              lastQRCodeDetectionTime = now;
            }
            
            // 判断是否在初次识别成功后的3秒内
            const timeSinceStart = now - initialDetectionTime;
            if (timeSinceStart <= 3000) {
              log('检测到二维码在识别成功后3秒内再次出现，继续保持窗口显示。');
              // 不执行显示窗口操作，因为窗口本来就是显示的
            } else {
              // 显示窗口并置顶
              mainWindow.show();
              mainWindow.focus();
            }
            
            // 获取并推送二维码
            await getAndPushQRCode(page, mainWindow);

            // 启动倒计时监控
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
            
            // 启动新定时器监控倒计时
            timer = await monitorQRCodeTimer(page, mainWindow);
          }

          if (!qrVisible && lastQRCodeVisible) {
            // 二维码弹窗刚刚消失（人脸识别成功）
            log('二维码弹窗消失，人脸识别成功，自动隐藏窗口到托盘。');
            // 更新初次检测时间，用于下次判断
            initialDetectionTime = Date.now();
            mainWindow.hide();
            // 清理倒计时定时器
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
            // 处理二维码识别成功
            await handleQRCodeSuccess(page, mainWindow);
          }

          lastQRCodeVisible = qrVisible;
        } catch (innerError) {
          // 内部错误处理，继续循环
          log('二维码守护内部错误: ' + innerError.message);
          await page.waitForTimeout(5000); // 出错后等待5秒再继续
        }
      }
    } catch (outerError) {
      // 外部错误处理
      log('二维码守护进程崩溃: ' + outerError.message);
      // 清理定时器
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      // 重新启动守护进程
      setTimeout(() => {
        startQRCodeGuardian(page, mainWindow).catch(e => {
          log('二维码守护进程重启失败: ' + e.message);
        });
      }, 5000);
    }
  }

  // ---------------------------------------------------------------------------
  /**
   * 启动进度监控定时器
   * @param {Page} page - Playwright页面实例
   * @param {BrowserWindow} mainWindow - 主窗口实例
   */
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

  // ---------------------------------------------------------------------------
  /**
   * 停止进度监控定时器
   */
  function stopProgressTimer() {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = null;
    currentLearningResourceId = null;
  }

  // ---------------------------------------------------------------------------
  /**
   * 获取课件列表
   * @param {Page} page - Playwright页面实例
   * @returns {Promise<Array>} 课件列表
   */
  async function getCourseList(page) {
    try {
      await page.waitForSelector('.video_list .kecheng_li', { state: 'attached', timeout: 10000 });
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
      return courseStats;
    } catch (e) {
      log('获取课件列表失败：' + (e && e.stack ? e.stack : e));
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  /**
   * 更新课件列表到UI
   * @param {Array} courseList - 课件列表
   * @param {BrowserWindow} mainWindow - 主窗口实例
   * @returns {Object} 学习中的课件信息
   */
  function updateCourseListUI(courseList, mainWindow) {
    if (!Array.isArray(courseList)) return null;
    
    // 取学习中课件的已观看时长
    const learning = courseList.find(c => c.status === '学习中');
    const currentWatchedSeconds = learning ? learning.learned : 0;
    
    // 更新课件列表
    mainWindow.webContents.send('update-course-list', { courseList, currentWatchedSeconds });
    
    return learning;
  }

  // ---------------------------------------------------------------------------
  /**
   * 初始化课件学习
   * @param {Page} page - Playwright页面实例
   * @param {BrowserWindow} mainWindow - 主窗口实例
   */
  async function initializeLearning(page, mainWindow) {
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

      // 获取并更新课件列表
      await updateCourseList(page, mainWindow, false);
      
      // 获取二维码并推送
      await initializeQRCode(page, mainWindow);
      
    } catch (e) {
      log('初始化课件学习失败：' + (e && e.stack ? e.stack : e));
    }
  }

  // ---------------------------------------------------------------------------
  /**
   * 更新课件列表
   * @param {Page} page - Playwright页面实例
   * @param {BrowserWindow} mainWindow - 主窗口实例
   * @param {boolean} [isManualRefresh=false] - 是否是手动刷新
   * @returns {Promise<boolean>} 是否成功更新
   */
  async function updateCourseList(page, mainWindow, isManualRefresh = false) {
    try {
      // 获取课件列表
      const courseStats = await getCourseList(page);
      if (!Array.isArray(courseStats)) {
        return false;
      }
      
      // 更新UI
      const learning = updateCourseListUI(courseStats, mainWindow);
      // 只在非手动刷新时输出日志
      if (!isManualRefresh) {
        log('课件列表已更新。');
        // 初次自动更新成功后，启用刷新按钮
        mainWindow.webContents.send('enable-refresh-button');
      }
      
      // 记录当前学习中课件的resourceid并启动定时器
      if (learning) {
        currentLearningResourceId = learning.resourceid;
        if (!progressTimer) startProgressTimer(page, mainWindow);
      } else {
        stopProgressTimer();
      }
      
      return true;
    } catch (e) {
      log('课件列表更新失败：' + (e && e.stack ? e.stack : e));
      return false;
    }
  }

  // ==================== 主进程相关函数 ====================

  /**
   * 创建主窗口
   */
  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1770,
      height: 920,
      minWidth: 1770,
      maxWidth: 1770,
      minHeight: 920,
      maxHeight: 920,
      resizable: false,
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

  /**
   * 创建系统托盘
   */
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

  // ==================== 主要业务函数 ====================

  /**
   * 启动自动化流程
   * @param {Object} config - 配置信息
   */
  async function startAutomation(config) {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({
      headless: true,
      executablePath: config.browserPath
    });
    const page = await browser.newPage();
    
    // 保存页面实例到全局变量，以便其他函数可以访问
    global.activePage = page;
    
    // 当浏览器关闭时，清除全局变量
    browser.on('disconnected', () => {
      global.activePage = null;
    });

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

        // 初始化课件学习
        await initializeLearning(page, mainWindow);
      } else if (feedbackText === '没有用户') {
        log('手机号输入错误，请重新输入。');
      } else if (feedbackText === '密码错误') {
        log('手机号或密码错误，请重新输入。');
      } else if (feedbackText === '验证码错误') {
        log('验证码错误，请重新输入。');
      } else {
        log('判定结果：登录失败或验证码错误，请重新输入。');
      }

      // 登录失败时清除全局页面实例
      if (!loginSuccess) {
        global.activePage = null;
      }

      // 登录成功则跳出循环，失败则重新获取验证码
      if (loginSuccess) break;
    }
  }

  // ==================== 事件监听 ====================

  // ---------------------------------------------------------------------------
  // 用户输入处理
  let userInputResolver = null;
  ipcMain.handle('user-input', async (event, data) => {
    if (userInputResolver) {
      userInputResolver(data);
      userInputResolver = null;
    }
  });

  // ---------------------------------------------------------------------------
  // 配置保存
  ipcMain.handle('save-config', (event, config) => {
    store.set('userConfig', config);
    return true;
  });

  // ---------------------------------------------------------------------------
  // 配置读取
  ipcMain.handle('get-config', () => {
    return store.get('userConfig') || {};
  });

  // ---------------------------------------------------------------------------
  // 启动自动化
  ipcMain.handle('start-playwright', async (event, config) => {
    startAutomation(config);
    return true;
  });

  // ---------------------------------------------------------------------------
  // 刷新课程列表
  ipcMain.handle('refresh-course-list', async (event) => {
    // 如果没有页面实例或者正在刷新，则返回
    if (!global.activePage) {
      return { success: false, message: '浏览器实例未初始化' };
    }
    
    try {
      const page = global.activePage;
      const success = await updateCourseList(page, mainWindow, true);
      if (success) {
        log('课件列表已手动刷新。');
        return { success: true };
      } else {
        return { success: false, message: '刷新失败' };
      }
    } catch (e) {
      log('课件列表手动刷新失败：' + (e && e.stack ? e.stack : e));
      return { success: false, message: e.message };
    }
  });

  // ---------------------------------------------------------------------------
  // 窗口最小化
  ipcMain.handle('minimize-window', () => {
    if (mainWindow) {
      mainWindow.hide();
      mainWindow.setSkipTaskbar(true);
    }
  });

  // ---------------------------------------------------------------------------
  // 退出应用程序
  ipcMain.handle('quit-app', () => {
    app.isQuiting = true;
    app.quit();
  });

  // ---------------------------------------------------------------------------
  // 窗口还原
  ipcMain.on('restore-window', (event) => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.setSkipTaskbar(false);
    }
  });

  // ---------------------------------------------------------------------------
  // 应用程序就绪
  app.whenReady().then(createWindow);

  // ---------------------------------------------------------------------------
  // 窗口关闭
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // ---------------------------------------------------------------------------
  // 全局未处理Promise异常捕获
  process.on('unhandledRejection', (reason, p) => {
    console.error('未处理的Promise异常:', reason);
  });
} 