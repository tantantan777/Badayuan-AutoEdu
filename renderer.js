// renderer.js
// 日志输入与展示逻辑
// 详细注释

const { ipcRenderer } = require('electron');

// 工具函数：去除路径前后引号
function stripQuotes(str) {
  return str.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
}

// 工具函数：获取当前时间戳 [HH:MM:SS]
function getTimeStamp() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `[${h}:${m}:${s}]`;
}

// 日志输出函数
function appendLog(msg) {
  const logs = document.getElementById('logs');
  const logEntry = document.createElement('div');
  logEntry.textContent = `${getTimeStamp()} ${msg}`;
  logs.appendChild(logEntry);
  logs.scrollTop = logs.scrollHeight;

  // 二维码识别成功后处理
  if (msg.includes('人脸识别成功')) {
    // 清空二维码图片
    const img = document.getElementById('qrcode-img');
    if (img) img.src = '';
    // 日志提示3秒后最小化
    appendLog('3s后自动最小化程序。');
    setTimeout(() => {
      ipcRenderer.send('minimize-window');
    }, 3000);
  }

  // 守护进程检测到二维码弹窗重新出现时自动还原窗口
  if (msg.includes('检测到二维码弹窗重新出现')) {
    ipcRenderer.send('restore-window');
  }
}

// 设置按钮为loading状态
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

// 发送按钮初始禁用
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

// 保存并开始按钮事件
// 详细注释

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
    appendLog('已保存浏览器路径并启动Playwright。');
    setBtnLoading(saveBtn, true, '已启动');
    sendBtn.disabled = false;
  } catch (e) {
    appendLog('浏览器启动失败，请检查路径！');
    setBtnLoading(saveBtn, false);
  }
};

// 发送按钮事件：发送手机号、密码、验证码到主进程，并保存手机号和密码到config.json
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

// 监听主进程推送的日志
electronLogHandler = (event, msg) => appendLog(msg);
ipcRenderer.on('log', electronLogHandler);

// 监听主进程推送的验证码图片
electronCaptchaHandler = (event, base64) => {
  const img = document.getElementById('captcha-img');
  if (base64 && base64.length > 0) {
  img.src = 'data:image/jpeg;base64,' + base64;
    img.style.display = '';
  } else {
    img.style.display = 'none';
  }
};
ipcRenderer.on('show-captcha', electronCaptchaHandler);

// 监听主进程推送的禁用发送按钮事件
ipcRenderer.on('disable-send-btn', () => {
  document.getElementById('send-btn').disabled = true;
});

// 手机号输入实时校验
const phoneInput = document.getElementById('phone-input');
phoneInput.addEventListener('input', function() {
  const val = phoneInput.value.trim();
  if (/^1\d{10}$/.test(val)) {
    document.getElementById('phone-error').textContent = '';
  }
});

// 密码输入实时校验
const passInput = document.getElementById('password-input');
passInput.addEventListener('input', function() {
  const val = passInput.value.trim();
  if (val) {
    document.getElementById('pass-error').textContent = '';
  }
});

// 监听主进程推送的进度信息
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

// 展示二维码图片
ipcRenderer.on('face-qrcode', (event, base64) => {
  const img = document.getElementById('qrcode-img');
  if (img) {
    if (base64 && base64.length > 0) {
    img.src = 'data:image/png;base64,' + base64;
      img.style.display = '';
  } else {
      img.src = '';
      img.style.display = 'none';
    }
  }
});

// 展示二维码倒计时
let qrcodeSuccess = false; // 标志：人脸识别成功后锁定UI

// 监听二维码倒计时
ipcRenderer.on('qrcode-timer', (event, remain) => {
  const timerElem = document.getElementById('qrcode-timer');
  if (!timerElem) return;
  if (remain === -1) {
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
    timerElem.textContent = `倒计时 ${remain} 秒`;
    timerElem.style.color = remain <= 10 ? 'red' : 'green';
  }
});

// 监听二维码图片推送，解锁倒计时显示
ipcRenderer.on('face-qrcode', () => {
  qrcodeSuccess = false;
});

// 状态变量：是否允许实时更新（人脸识别通过后为true，二维码弹出为false）
let isPlaying = false;
let selectedLi = null;
let currentTotalSeconds = 0;
let finishedCourseTotalSeconds = 0;

// 监听二维码弹出，切换为静态模式
window.electronAPI = window.electronAPI || {};
ipcRenderer.on('face-qrcode', () => {
  isPlaying = false;
  selectedLi = null;
});

// 监听人脸识别通过，切换为实时模式
ipcRenderer.on('face-play', () => {
  isPlaying = true;
  // 记录当前Selected元素和总时长
  selectedLi = document.querySelector('.kecheng_li.Selected');
  if (selectedLi) {
    currentTotalSeconds = Number(selectedLi.getAttribute('data-totalcount')) || 0;
  }
  // finishedCourseTotalSeconds 需在update-course-list时同步
});

// 监听主进程推送课件列表，统计静态时长
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
  function timeToSec(str) {
    if (!str) return 0;
    const parts = str.split(':').map(Number);
    if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
    if (parts.length === 2) return parts[0]*60 + parts[1];
    return 0;
  }
  function secToTime(sec) {
    sec = Math.round(sec);
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }
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
  let currentTotalSeconds = data.currentTotalSeconds || timeToSec(currentTotalDuration);
  document.getElementById('total-course-count').textContent = totalCourseCount;
  document.getElementById('finished-course-count').textContent = finishedCourseCount;
  document.getElementById('total-duration').textContent = secToTime(totalDurationSec);
  document.getElementById('current-total-duration').textContent = secToTime(currentTotalSeconds);
  document.getElementById('current-watched-duration').textContent = secToTime(currentWatchedSeconds);
  // 剩余未观看课件总时长 = 总时长-已学完时长-本节课已观看时长
  const remainSeconds = totalDurationSec - finishedCourseTotalSeconds - currentWatchedSeconds;
  document.getElementById('remain-duration').textContent = secToTime(remainSeconds);
  // 预计完成时间 = 当前北京时间 + (本节课总时长-已观看时长)
  const now = new Date();
  const finishTime = new Date(now.getTime() + (currentTotalSeconds - currentWatchedSeconds) * 1000);
  document.getElementById('lesson-finish-time').textContent = finishTime.toTimeString().slice(0,8);
});

// 监听本节课已观看时长实时更新事件
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
    elem.style.color = 'green'; // 只让时间为绿色
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

// 实时刷新本节课已观看时长、剩余未观看课件总时长、预计完成时间
setInterval(() => {
  if (!isPlaying || !selectedLi) return;
  const watched = Number(selectedLi.getAttribute('data-secondslearned')) || 0;
  // 更新本节课已观看时长
  document.getElementById('current-watched-duration').textContent = secToTime(watched);
  // 剩余未观看课件总时长
  const remainSeconds = (currentTotalSeconds + finishedCourseTotalSeconds) - finishedCourseTotalSeconds - watched;
  document.getElementById('remain-duration').textContent = secToTime(remainSeconds);
  // 预计完成时间
  const finishTime = new Date(Date.now() + (currentTotalSeconds - watched) * 1000);
  document.getElementById('lesson-finish-time').textContent = finishTime.toTimeString().slice(0,8);
  // 课件完成后自动刷新
  if (watched === currentTotalSeconds && currentTotalSeconds > 0) {
    isPlaying = false;
    selectedLi = null;
    ipcRenderer.invoke('refresh-course-list');
  }
}, 1000); 