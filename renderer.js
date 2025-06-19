// renderer.js
// 日志输入与展示逻辑
// 详细注释

const { ipcRenderer } = require('electron');

// 全局状态变量
let minimizeTimer = null;           // 窗口最小化计时器
let qrcodeSuccess = false;          // 人脸识别成功标志
let isPlaying = false;              // 播放状态标志
let selectedLi = null;              // 当前选中的课程项
let currentTotalSeconds = 0;        // 当前课程总时长
let finishedCourseTotalSeconds = 0; // 已完成课程总时长
let lastWatchedSeconds = 0;         // 上次观察到的观看时长，用于检测是否在播放

// ==================== 工具函数 ====================

/**
 * 去除路径字符串前后的引号
 * @param {string} str - 输入字符串
 * @returns {string} 处理后的字符串
 */
function stripQuotes(str) {
  return str.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
}

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
 * 时间字符串转换为秒数
 * @param {string} str - 时间字符串 (HH:MM:SS)
 * @returns {number} 秒数
 */
function timeToSec(str) {
  if (!str) return 0;
  const parts = str.split(':').map(Number);
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
  if (parts.length === 2) return parts[0]*60 + parts[1];
  return 0;
}

/**
 * 秒数转换为时间字符串
 * @param {number} sec - 秒数
 * @returns {string} 格式化的时间字符串 (HH:MM:SS)
 */
function secToTime(sec) {
  sec = Math.round(sec);
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// ==================== UI 交互函数 ====================

/**
 * 更新日志显示
 * @param {string} msg - 日志消息
 */
function updateLog(msg) {
  // 静态变量用于跟踪最后一条日志
  if (!updateLog.lastMessage) {
    updateLog.lastMessage = '';
  }
  
  // 确保所有日志都有时间戳
  if (!msg.startsWith('[')) {
    msg = `${getTimeStamp()} ${msg}`;
  }
  
  // 提取消息内容(不含时间戳)
  const msgContent = msg.substring(msg.indexOf(']') + 1).trim();
  
  // 检查是否与上一条日志内容相同
  if (msgContent === updateLog.lastMessage) {
    return; // 跳过重复日志
  }
  
  // 更新最后一条日志内容
  updateLog.lastMessage = msgContent;
  
  const logs = document.getElementById('logs');
  
  // 如果日志条目过多（超过100条），移除最早的日志
  while (logs.childNodes.length >= 100) {
    logs.removeChild(logs.firstChild);
  }
  
  const logEntry = document.createElement('div');
  logEntry.textContent = msg;
  logs.appendChild(logEntry);

  // 二维码识别成功后处理
  if (msg.includes('人脸识别成功')) {
    // 清空二维码图片
    const img = document.getElementById('qrcode-img');
    if (img) {
      img.src = '';
      img.style.display = 'none';
    }
    
    // 更新倒计时显示
    const timerElem = document.getElementById('qrcode-timer');
    if (timerElem) {
      timerElem.textContent = '人脸识别成功';
      timerElem.style.color = 'green';
    }
    
    // 如果消息中包含"自动隐藏窗口"，则设置定时器
    if (msg.includes('自动隐藏窗口')) {
      if (minimizeTimer) {
        clearTimeout(minimizeTimer);
      }
      minimizeTimer = setTimeout(() => {
        ipcRenderer.send('minimize-window');
      }, 3000);
    }
  }

  // 守护进程检测到二维码弹窗重新出现时自动还原窗口
  if (msg.includes('检测到二维码弹窗出现')) {
    if (minimizeTimer) {
      clearTimeout(minimizeTimer);
      minimizeTimer = null;
    }
    ipcRenderer.send('restore-window');
  }
}

/**
 * 设置按钮加载状态
 * @param {HTMLElement} btn - 按钮元素
 * @param {boolean} loading - 是否处于加载状态
 * @param {string} text - 加载状态显示文本
 */
function setBtnLoading(btn, loading = true, text = '处理中...') {
  if (loading) {
    btn.classList.add('loading');
    btn.disabled = true;
    btn.dataset.originText = btn.textContent;
    btn.textContent = text;
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
    if (btn.dataset.originText) btn.textContent = btn.dataset.originText;
  }
}

// ==================== 事件监听函数 ====================

/**
 * 页面加载完成事件处理
 */
window.onload = async function() {
  document.getElementById('send-btn').disabled = true;
  const config = await ipcRenderer.invoke('get-config');
  if (config && config.browserPath) {
    document.getElementById('browser-path-input').value = config.browserPath;
  }
  if (config && config.phone) {
    document.getElementById('phone-input').value = config.phone;
  }
  if (config && config.pass) {
    document.getElementById('password-input').value = config.pass;
  }
};

/**
 * 保存配置并启动程序
 */
document.getElementById('save-start-btn').onclick = async function() {
  let browserPath = document.getElementById('browser-path-input').value.trim();
  browserPath = stripQuotes(browserPath); // 去除前后引号
  const config = { browserPath };
  // 禁用按钮防止重复点击
  const saveBtn = document.getElementById('save-start-btn');
  const sendBtn = document.getElementById('send-btn');
  setBtnLoading(saveBtn, true);
  try {
    await ipcRenderer.invoke('save-config', config);
    await ipcRenderer.invoke('start-playwright', config);
    updateLog('已打开四川省八大员继续教育系统网页。');
    setBtnLoading(saveBtn, true, '已启动');
    sendBtn.disabled = false;
  } catch (e) {
    updateLog('浏览器启动失败，请检查路径！');
    setBtnLoading(saveBtn, false);
  }
};

/**
 * 发送用户输入信息
 */
document.getElementById('send-btn').onclick = async function() {
  const phone = document.getElementById('phone-input').value.trim();
  const pass = document.getElementById('password-input').value.trim();
  const captcha = document.getElementById('captcha-input').value.trim();
  // 清除旧的错误提示
  document.getElementById('phone-error').textContent = '';
  document.getElementById('pass-error').textContent = '';
  // 校验手机号和密码
  let hasError = false;
  if (!/^1\d{10}$/.test(phone)) {
    document.getElementById('phone-error').textContent = '请输入正确的11位手机号（1开头）';
    hasError = true;
  }
  if (!pass) {
    document.getElementById('pass-error').textContent = '密码不能为空';
    hasError = true;
  }
  if (hasError) return;
  // 保存手机号和密码到config.json
  const config = await ipcRenderer.invoke('get-config') || {};
  config.phone = phone;
  config.pass = pass;
  await ipcRenderer.invoke('save-config', config);
  ipcRenderer.invoke('user-input', { phone, pass, captcha });
  // 清空验证码输入框
  document.getElementById('captcha-input').value = '';
};

// 监听主进程日志消息
ipcRenderer.on('log', (event, msg) => updateLog(msg));
ipcRenderer.on('show-captcha', (event, base64) => {
  const img = document.getElementById('captcha-img');
  if (base64 && base64.length > 0) {
  img.src = 'data:image/jpeg;base64,' + base64;
    img.style.display = '';
  } else {
    img.style.display = 'none';
  }
});
ipcRenderer.on('disable-send-btn', () => {
  document.getElementById('send-btn').disabled = true;
});

// 表单验证事件监听
const phoneInput = document.getElementById('phone-input');
phoneInput.addEventListener('input', function() {
  const val = phoneInput.value.trim();
  if (/^1\d{10}$/.test(val)) {
    document.getElementById('phone-error').textContent = '';
  }
});

const passInput = document.getElementById('password-input');
passInput.addEventListener('input', function() {
  const val = passInput.value.trim();
  if (val) {
    document.getElementById('pass-error').textContent = '';
  }
});

// 课程进度更新事件监听
ipcRenderer.on('update-progress', (event, data) => {
  // 课件总数
  document.getElementById('total-course-count').textContent = data.totalCourseCount;
  // 已完成课件数
  document.getElementById('finished-course-count').textContent = data.finishedCourseCount;
  // 所有课件总时长
  document.getElementById('total-duration').textContent = data.totalDuration;
  // 剩余未观看课件总时长
  document.getElementById('remain-duration').textContent = data.remainDuration;
  // 本节课预计完成时间
  document.getElementById('lesson-finish-time').textContent = data.lessonFinishTime;
  // 本节课总时长和已观看时长不再用主进程推送，统一用播放器HTML结构实时刷新
});

// 二维码相关事件监听
ipcRenderer.on('face-qrcode', (event, base64) => {
  const img = document.getElementById('qrcode-img');
  if (img) {
    if (base64 && base64.length > 0) {
    img.src = 'data:image/png;base64,' + base64;
      img.style.display = '';
      // 重置二维码状态
      qrcodeSuccess = false;
      // 重置倒计时显示
      const timerElem = document.getElementById('qrcode-timer');
      if (timerElem) {
        timerElem.textContent = '等待倒计时...';
        timerElem.style.color = 'black';
      }
      // 添加日志
      updateLog('收到新的二维码，请使用微信扫描。');
  } else {
      img.src = '';
      img.style.display = 'none';
    }
  }
});

ipcRenderer.on('qrcode-timer', (event, remain) => {
  const timerElem = document.getElementById('qrcode-timer');
  if (!timerElem) return;
  
  if (remain === -1) {
    // 人脸识别成功
    timerElem.textContent = '人脸识别成功';
    timerElem.style.color = 'green';
    qrcodeSuccess = true; // 锁定
    
    // 清空并隐藏二维码图片
    const img = document.getElementById('qrcode-img');
    if (img) {
      img.src = '';
      img.style.display = 'none';
    }
  } else if (!qrcodeSuccess) {
    // 直接显示从页面获取的倒计时文本
    if (typeof remain === 'string') {
    timerElem.textContent = remain;
      
    // 如果倒计时小于10秒，显示红色警告
    if ((remain.includes('0分') && remain.match(/(\d+)秒/) && parseInt(remain.match(/(\d+)秒/)[1]) < 10) ||
        remain.includes('0分0秒')) {
      timerElem.style.color = 'red';
    } else {
      timerElem.style.color = 'green';
      }
    } else {
      timerElem.textContent = '等待倒计时...';
      timerElem.style.color = 'black';
    }
  }
});

// 课程列表更新事件监听
ipcRenderer.on('update-course-list', (event, data) => {
  const courseList = data.courseList || [];
  const listDiv = document.getElementById('course-list');
  if (!listDiv) return;
  // 构建表头
  let html = `<div class=\"course-list-header\" style=\"display:flex;font-weight:bold;padding:4px 0;border-bottom:1px solid #eee;\">
    <span style=\"flex:0 0 60px;\">状态</span>
    <span style=\"flex:1;\">课件名</span>
    <span style=\"flex:0 0 80px;text-align:right;\">时长</span>
  </div>`;
  // 构建每一行
  html += courseList.map(item =>
    `<div class=\"course-list-row\" style=\"display:flex;padding:4px 0;border-bottom:1px solid #f4f4f4;align-items:center;\">
      <span style=\"flex:0 0 60px;color:${item.status==='已学完'?'#52c41a':item.status==='学习中'?'#faad14':'#888'};font-weight:${item.status==='学习中'?'bold':'normal'};\">${item.status}</span>
      <span style=\"flex:1;\">${item.name}</span>
      <span style=\"flex:0 0 80px;text-align:right;\">${item.duration}</span>
    </div>`
  ).join('');
  listDiv.innerHTML = html;

  // 统计进度信息
  const totalCourseCount = courseList.length;
  const finishedCourseCount = courseList.filter(item => item.status === '已学完').length;
  const totalDurationSec = courseList.reduce((sum, item) => sum + timeToSec(item.duration), 0);
  finishedCourseTotalSeconds = courseList.filter(item => item.status === '已学完').reduce((sum, item) => {
    const parts = item.duration.split(':').map(Number);
    let sec = 0;
    if (parts.length === 3) sec = parts[0]*3600 + parts[1]*60 + parts[2];
    else if (parts.length === 2) sec = parts[0]*60 + parts[1];
    return sum + sec;
  }, 0);
  // 本节课：优先取学习中课件
  let currentCourse = courseList.find(item => item.status === '学习中');
  if (!currentCourse) {
    currentCourse = courseList.find(item => item.status !== '已学完') || courseList[0];
  }
  let currentTotalDuration = currentCourse ? currentCourse.duration : '00:00:00';
  // 已观看时长直接用主进程推送的currentWatchedSeconds
  let currentWatchedSeconds = data.currentWatchedSeconds || 0;
  let currentTotalSeconds = timeToSec(currentTotalDuration);
  document.getElementById('total-course-count').textContent = totalCourseCount;
  document.getElementById('finished-course-count').textContent = finishedCourseCount;
  document.getElementById('total-duration').textContent = secToTime(totalDurationSec);
  document.getElementById('current-total-duration').textContent = secToTime(currentTotalSeconds);
  
  const currentWatchedElem = document.getElementById('current-watched-duration');
  if (currentWatchedElem) {
    currentWatchedElem.textContent = secToTime(currentWatchedSeconds);
    currentWatchedElem.style.color = 'red'; // 初始状态为暂停(红色)
    // 重置lastWatchedSeconds以便下次检测播放状态
    lastWatchedSeconds = currentWatchedSeconds;
  }
  
  // 剩余未观看课件总时长 = 总时长-已学完时长-本节课已观看时长
  const remainSeconds = totalDurationSec - finishedCourseTotalSeconds - currentWatchedSeconds;
  document.getElementById('remain-duration').textContent = secToTime(remainSeconds);
  // 预计完成时间 = 当前北京时间 + (本节课总时长-已观看时长)
  const now = new Date();
  // 确保预计完成时间不会是负值（当已学习时长大于课程总时长时）
  const remainingSeconds = Math.max(0, currentTotalSeconds - currentWatchedSeconds);
  const finishTime = new Date(now.getTime() + remainingSeconds * 1000);
  document.getElementById('lesson-finish-time').textContent = finishTime.toTimeString().slice(0,8);
});

ipcRenderer.on('update-current-learned', (event, data) => {
  const seconds = data.learned || 0;
  // 格式化为 00:00:00
  const format = (sec) => {
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };
  const elem = document.getElementById('current-watched-duration');
  if (elem) {
    elem.textContent = format(seconds);
    
    // 检测播放状态：如果当前时长与上次时长不同，则视为正在播放
    const isCurrentlyPlaying = seconds > lastWatchedSeconds;
    // 更新颜色：播放中为绿色，暂停为红色
    elem.style.color = isCurrentlyPlaying ? 'green' : 'red';
    // 更新上次观察到的时长
    lastWatchedSeconds = seconds;
  }
  // 实时刷新剩余未观看课件总时长
  if (typeof data.remainSeconds === 'number') {
    const remainElem = document.getElementById('remain-duration');
    if (remainElem) remainElem.textContent = format(data.remainSeconds);
  }
  // 实时刷新本节课预计完成时间
  if (data.finishTimeStr) {
    const finishElem = document.getElementById('lesson-finish-time');
    if (finishElem) finishElem.textContent = data.finishTimeStr;
  }
});

// ==================== 定时器和自动化函数 ====================

/**
 * 实时更新课程进度
 */
setInterval(() => {
  if (!isPlaying || !selectedLi) return;
  const watched = Number(selectedLi.getAttribute('data-secondslearned')) || 0;
  // 更新本节课已观看时长
  const currentWatchedElem = document.getElementById('current-watched-duration');
  if (currentWatchedElem) {
    currentWatchedElem.textContent = secToTime(watched);
    // 检测播放状态：如果当前时长与上次时长不同，则视为正在播放
    const isCurrentlyPlaying = watched > lastWatchedSeconds;
    // 更新颜色：播放中为绿色，暂停为红色
    currentWatchedElem.style.color = isCurrentlyPlaying ? 'green' : 'red';
    // 更新上次观察到的时长
    lastWatchedSeconds = watched;
  }
  
  // 剩余未观看课件总时长（确保不会出现负值）
  const remainSeconds = Math.max(0, (currentTotalSeconds + finishedCourseTotalSeconds) - finishedCourseTotalSeconds - watched);
  document.getElementById('remain-duration').textContent = secToTime(remainSeconds);
  // 预计完成时间（确保不会出现负值）
  const remainingSeconds = Math.max(0, currentTotalSeconds - watched);
  const finishTime = new Date(Date.now() + remainingSeconds * 1000);
  document.getElementById('lesson-finish-time').textContent = finishTime.toTimeString().slice(0,8);
  // 课件完成后自动刷新（当观看时间等于或超过总时长时）
  if ((watched >= currentTotalSeconds) && currentTotalSeconds > 0) {
    isPlaying = false;
    selectedLi = null;
    ipcRenderer.invoke('refresh-course-list');
  }
}, 1000);

/**
 * 刷新课程列表按钮初始化
 */
document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('refresh-course-list-btn');
  if (refreshBtn) {
    // 初始时禁用刷新按钮
    refreshBtn.disabled = true;
    
    refreshBtn.addEventListener('click', async function() {
      // 设置按钮为加载状态
      const originalText = refreshBtn.innerHTML;
      refreshBtn.innerHTML = '<span class="refresh-icon" style="animation: spin 1s linear infinite;">↻</span>';
      refreshBtn.disabled = true;
      
      try {
        // 调用主进程刷新课程列表
        const result = await ipcRenderer.invoke('refresh-course-list');
        if (!result || !result.success) {
          updateLog('刷新课件列表失败: ' + (result?.message || '未知错误'));
        }
      } catch (error) {
        updateLog('刷新课件列表出错: ' + error.message);
      } finally {
        // 恢复按钮状态
        setTimeout(() => {
          refreshBtn.innerHTML = originalText;
          refreshBtn.disabled = false;
        }, 1000);
      }
    });
  }
});

// 监听启用刷新按钮的事件
ipcRenderer.on('enable-refresh-button', () => {
  const refreshBtn = document.getElementById('refresh-course-list-btn');
  if (refreshBtn) {
    refreshBtn.disabled = false;
  }
});

// 退出按钮点击事件
document.getElementById('quit-btn').addEventListener('click', () => {
  ipcRenderer.invoke('quit-app');
}); 