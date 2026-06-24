/**
 * zhongwen-agent · 仪表盘前端逻辑
 * 
 * 负责数据获取、图表渲染、实时更新。
 */

// ============================================================
// 全局状态
// ============================================================

let trendChart = null;
let violationChart = null;
let currentRange = '7d';
let updateInterval = null;

// ============================================================
// 数据获取
// ============================================================

/**
 * 获取仪表板数据
 * 
 * @param {string} range - 时间范围
 * @returns {Promise<object>} 仪表板数据
 */
async function fetchDashboardData(range = '7d') {
  try {
    const response = await fetch(`/api/dashboard?range=${range}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('获取仪表板数据失败:', error);
    return null;
  }
}

// ============================================================
// UI 更新
// ============================================================

/**
 * 更新仪表板
 * 
 * @param {string} range - 时间范围
 */
async function updateDashboard(range = '7d') {
  currentRange = range;
  
  // 更新按钮状态
  document.querySelectorAll('.btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.textContent.includes(range === '7d' ? '7' : range === '30d' ? '30' : '全部')) {
      btn.classList.add('active');
    }
  });
  
  const data = await fetchDashboardData(range);
  if (!data) {
    showError('无法获取仪表板数据');
    return;
  }
  
  updateStatusCards(data.status);
  updateTrendChart(data.trends);
  updateViolationChart(data.distributions);
  updateHeatmap(data.heatmap);
  updateRankings(data.rankings);
  updateSuggestions(data.rankings);
  updateLastUpdate();
}

/**
 * 更新状态卡片
 * 
 * @param {object} status - 状态数据
 */
function updateStatusCards(status) {
  // 当前纯度
  const purityEl = document.getElementById('currentPurity');
  purityEl.textContent = status.current_purity.toFixed(1) + '%';
  purityEl.style.color = getPurityColor(status.current_purity);
  
  // 检查次数
  document.getElementById('totalChecks').textContent = status.total_checks;
  
  // 违规次数
  document.getElementById('totalViolations').textContent = status.total_violations;
  
  // 违规率
  const rateEl = document.getElementById('violationRate');
  rateEl.textContent = `违规率: ${status.violation_rate.toFixed(1)}%`;
  rateEl.className = 'metric-change ' + (status.violation_rate > 20 ? 'negative' : 'positive');
  
  // 质量评分
  const scoreEl = document.getElementById('qualityScore');
  scoreEl.textContent = status.quality_score;
  scoreEl.style.color = getScoreColor(status.quality_score);
  
  // 评分详情
  const scoreDetails = document.getElementById('scoreDetails');
  scoreDetails.textContent = getScoreDescription(status.quality_score);
  
  // 状态指示器
  const indicator = document.getElementById('statusIndicator');
  indicator.className = 'status-indicator ' + (status.total_checks > 0 ? 'online' : 'offline');
}

/**
 * 获取纯度颜色
 * 
 * @param {number} purity - 纯度值
 * @returns {string} 颜色
 */
function getPurityColor(purity) {
  if (purity >= 90) return '#3fb950';
  if (purity >= 70) return '#d29922';
  return '#f85149';
}

/**
 * 获取评分颜色
 * 
 * @param {number} score - 评分值
 * @returns {string} 颜色
 */
function getScoreColor(score) {
  if (score >= 90) return '#3fb950';
  if (score >= 70) return '#d29922';
  return '#f85149';
}

/**
 * 获取评分描述
 * 
 * @param {number} score - 评分值
 * @returns {string} 描述
 */
function getScoreDescription(score) {
  if (score >= 90) return '优秀';
  if (score >= 70) return '良好';
  if (score >= 60) return '一般';
  return '需要改进';
}

/**
 * 更新趋势图表
 * 
 * @param {object} trends - 趋势数据
 */
function updateTrendChart(trends) {
  const ctx = document.getElementById('trendChart').getContext('2d');
  
  const labels = trends.purity_trend.map(item => item.date);
  const purityData = trends.purity_trend.map(item => item.purity);
  const violationData = trends.violation_trend.map(item => item.count);
  
  if (trendChart) {
    trendChart.destroy();
  }
  
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: '中文纯度 (%)',
          data: purityData,
          borderColor: '#58a6ff',
          backgroundColor: 'rgba(88, 166, 255, 0.1)',
          tension: 0.4,
          fill: true,
          yAxisID: 'y'
        },
        {
          label: '违规次数',
          data: violationData,
          borderColor: '#f85149',
          backgroundColor: 'rgba(248, 81, 73, 0.1)',
          tension: 0.4,
          fill: true,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          min: 0,
          max: 100,
          title: {
            display: true,
            text: '纯度 (%)',
            color: '#58a6ff'
          },
          ticks: { color: '#8b949e' },
          grid: { color: '#21262d' }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          beginAtZero: true,
          title: {
            display: true,
            text: '违规次数',
            color: '#f85149'
          },
          ticks: { color: '#8b949e' },
          grid: { drawOnChartArea: false }
        },
        x: {
          ticks: { color: '#8b949e' },
          grid: { color: '#21262d' }
        }
      },
      plugins: {
        legend: {
          labels: { color: '#c9d1d9' }
        }
      }
    }
  });
}

/**
 * 更新违规分布图表
 * 
 * @param {object} distributions - 分布数据
 */
function updateViolationChart(distributions) {
  const ctx = document.getElementById('violationChart').getContext('2d');
  
  const types = distributions.violation_types.map(item => item.type);
  const counts = distributions.violation_types.map(item => item.count);
  
  if (violationChart) {
    violationChart.destroy();
  }
  
  if (counts.length === 0) {
    // 显示空状态
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#8b949e';
    ctx.textAlign = 'center';
    ctx.fillText('暂无违规数据', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }
  
  violationChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: types,
      datasets: [{
        data: counts,
        backgroundColor: [
          '#f85149',
          '#d29922',
          '#58a6ff',
          '#3fb950',
          '#a371f7',
          '#f778ba'
        ],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#c9d1d9' }
        }
      }
    }
  });
}

/**
 * 更新热力图
 * 
 * @param {object} heatmapData - 热力图数据
 */
function updateHeatmap(heatmapData) {
  const container = document.getElementById('heatmap');
  container.innerHTML = '';
  
  const { data, max_value, labels } = heatmapData;
  
  // 创建小时标签行
  const emptyCorner = document.createElement('div');
  container.appendChild(emptyCorner);
  
  for (let h = 0; h < 24; h++) {
    const header = document.createElement('div');
    header.className = 'heatmap-header';
    header.textContent = h % 3 === 0 ? `${h}时` : '';
    container.appendChild(header);
  }
  
  // 创建数据行
  for (let d = 0; d < 7; d++) {
    // 星期标签
    const dayLabel = document.createElement('div');
    dayLabel.className = 'heatmap-day-label';
    dayLabel.textContent = labels.days[d];
    container.appendChild(dayLabel);
    
    // 小时数据
    for (let h = 0; h < 24; h++) {
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      
      const value = data[d][h];
      const intensity = max_value > 0 ? value / max_value : 0;
      
      cell.style.backgroundColor = getHeatmapColor(intensity);
      cell.textContent = value > 0 ? value : '';
      cell.title = `${labels.days[d]} ${h}时: ${value} 次违规`;
      
      container.appendChild(cell);
    }
  }
}

/**
 * 获取热力图颜色
 * 
 * @param {number} intensity - 强度（0-1）
 * @returns {string} 颜色
 */
function getHeatmapColor(intensity) {
  if (intensity === 0) return '#21262d';
  
  // 从绿色到黄色到红色
  const r = Math.floor(255 * intensity);
  const g = Math.floor(255 * (1 - intensity * 0.5));
  const b = Math.floor(100 * (1 - intensity));
  
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * 更新排名
 * 
 * @param {object} rankings - 排名数据
 */
function updateRankings(rankings) {
  const container = document.getElementById('topTerms');
  
  if (!rankings.top_violation_terms || rankings.top_violation_terms.length === 0) {
    container.innerHTML = `
      <li class="empty-state">
        <div class="empty-state-icon">📝</div>
        <div>暂无数据</div>
      </li>
    `;
    return;
  }
  
  container.innerHTML = rankings.top_violation_terms.map((item, index) => `
    <li class="ranking-item">
      <span class="ranking-term">${index + 1}. ${item.term}</span>
      <span class="ranking-count">${item.count} 次</span>
    </li>
  `).join('');
}

/**
 * 更新改进建议
 * 
 * @param {object} rankings - 排名数据
 */
function updateSuggestions(rankings) {
  const container = document.getElementById('suggestions');
  
  if (!rankings.improvement_suggestions || rankings.improvement_suggestions.length === 0) {
    container.innerHTML = '<li class="suggestion-item">暂无改进建议，继续保持！</li>';
    return;
  }
  
  container.innerHTML = rankings.improvement_suggestions.map(suggestion => `
    <li class="suggestion-item">${suggestion}</li>
  `).join('');
}

/**
 * 更新最后更新时间
 */
function updateLastUpdate() {
  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN');
  document.getElementById('lastUpdate').textContent = `最后更新: ${timeStr}`;
}

/**
 * 显示错误
 * 
 * @param {string} message - 错误消息
 */
function showError(message) {
  console.error(message);
  document.getElementById('lastUpdate').textContent = `错误: ${message}`;
}

// ============================================================
// 实时更新
// ============================================================

/**
 * 启动实时更新
 */
function startRealtimeUpdates() {
  // 每 30 秒更新一次
  updateInterval = setInterval(() => {
    updateDashboard(currentRange);
  }, 30000);
}

/**
 * 停止实时更新
 */
function stopRealtimeUpdates() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
}

// ============================================================
// 初始化
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // 初始加载
  updateDashboard('7d');
  
  // 启动实时更新
  startRealtimeUpdates();
  
  // 页面关闭时停止更新
  window.addEventListener('beforeunload', () => {
    stopRealtimeUpdates();
  });
});
